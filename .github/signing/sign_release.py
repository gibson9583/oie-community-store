#!/usr/bin/env python3
"""Sign the explicitly selected plugin JARs, then atomically replace the ZIP.

Requires Python 3.10+ and JDK 17+. No third-party Python dependencies.
"""

import argparse
import fnmatch
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import tempfile
import urllib.request
import zipfile


HERE = Path(__file__).resolve().parent
TOOL_URL = "https://github.com/SSLcom/CodeSignTool/releases/download/v1.3.2/CodeSignTool-v1.3.2.zip"
TOOL_SHA256 = "f14b1e1ef14bfa1fd00279c363aab0debbf5dcfba0e4bcdce5d22bb771de0e3a"
SECRET_NAMES = (
    "SSL_COM_USERNAME", "SSL_COM_PASSWORD", "SSL_COM_CREDENTIAL_ID", "SSL_COM_TOTP_SECRET",
)


def fingerprint(value):
    value = value.replace(":", "").strip().lower()
    if not re.fullmatch(r"[0-9a-f]{64}", value):
        raise ValueError("SSL_COM_CERT_SHA256 must be the signing certificate's SHA-256 fingerprint")
    return value


def check_config():
    missing = [name for name in SECRET_NAMES if not os.environ.get(name, "").strip()]
    if missing:
        raise ValueError("Missing GitHub Actions secrets: " + ", ".join(missing))
    return fingerprint(os.environ.get("SSL_COM_CERT_SHA256", ""))


def checked_entries(archive):
    entries = {}
    for entry in archive.infolist():
        name = entry.filename
        path = PurePosixPath(name)
        if (name in entries or path.is_absolute() or ".." in path.parts
                or "\\" in name or str(path) != name.rstrip("/")
                or stat.S_ISLNK(entry.external_attr >> 16)):
            raise ValueError(f"Unsafe or duplicate ZIP entry: {name}")
        entries[name] = entry
    return entries


def signature_metadata(name):
    name = name.upper()
    if not name.startswith("META-INF/") or name.count("/") != 1:
        return False
    leaf = name.removeprefix("META-INF/")
    return (leaf == "MANIFEST.MF" or leaf.startswith("SIG-")
            or leaf.endswith((".SF", ".RSA", ".DSA", ".EC")))


def jar_payload(data):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = checked_entries(archive)
        return {name: archive.read(entry) for name, entry in entries.items()
                if not entry.is_dir() and not signature_metadata(name)}


def select_jars(archive, patterns):
    entries = checked_entries(archive)
    selected = []
    if not patterns:
        raise ValueError("No plugin JARs configured")
    for pattern in patterns:
        matches = [name for name, entry in entries.items()
                   if not entry.is_dir() and fnmatch.fnmatchcase(name, pattern)]
        if len(matches) != 1 or not matches[0].endswith(".jar"):
            raise ValueError(f"Expected exactly one JAR matching {pattern}, got {matches}")
        selected.extend(matches)
    if len({PurePosixPath(name).name for name in selected}) != len(selected):
        raise ValueError("Signing selection contains duplicate JAR filenames")
    return selected


def install_tool(directory):
    with urllib.request.urlopen(TOOL_URL, timeout=60) as response:
        data = response.read()
    if hashlib.sha256(data).hexdigest() != TOOL_SHA256:
        raise ValueError("CodeSignTool download SHA-256 mismatch")
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        checked_entries(archive)
        archive.extractall(directory)
    return directory / "jar/code_sign_tool-1.3.2.jar"


def cloud_sign(tool, inputs, outputs):
    # Use an argument array: passwords are never interpolated into shell code.
    # CodeSignTool can log credentials/tokens; keep all its output private and
    # delete its working directory (including logs) when this invocation ends.
    command = ["java", "-jar", str(tool), "batch_sign",
               "-username=" + os.environ["SSL_COM_USERNAME"],
               "-password=" + os.environ["SSL_COM_PASSWORD"],
               "-credential_id=" + os.environ["SSL_COM_CREDENTIAL_ID"],
               "-totp_secret=" + os.environ["SSL_COM_TOTP_SECRET"],
               "-input_dir_path=" + str(inputs), "-output_dir_path=" + str(outputs)]
    try:
        result = subprocess.run(command, cwd=tool.parent.parent, stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=600)
    except subprocess.TimeoutExpired:
        raise ValueError("SSL.com signing timed out; the release ZIP was not changed") from None
    if result.returncode:
        raise ValueError("SSL.com signing failed; check eSigner enrollment, credentials and quota")
    # Some CodeSignTool errors exit zero. The complete output set and real Java
    # signatures are checked independently below, never inferred from its log.


def verify_jar(path, expected_fingerprint, *, truststore=None):
    command = ["jarsigner", "-verify", "-strict", "-verbose", "-certs"]
    # Used by offline tests with their temporary CA; releases use the JDK roots.
    if truststore is not None:
        command += ["-keystore", str(truststore), "-storepass", "changeit"]
    command.append(str(path))
    result = subprocess.run(command, capture_output=True, text=True, timeout=120)
    if result.returncode:
        raise ValueError(f"JAR trust/signature verification failed for {path.name}:\n{result.stdout}{result.stderr}")
    # jarsigner alone may succeed for an unsigned JAR or omit timestamp checks.
    result = subprocess.run(["java", str(HERE / "VerifyJar.java"), str(path), expected_fingerprint],
                            capture_output=True, text=True, timeout=120)
    if result.returncode:
        raise ValueError(f"JAR signer/coverage/timestamp verification failed for {path.name}:\n{result.stdout}{result.stderr}")


def replace_jars(bundle, signed):
    # All signing and verification completes before the original ZIP is touched.
    # Preserve entry metadata/order and byte contents for every unselected entry.
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(dir=bundle.parent, suffix=".signed.zip", delete=False) as temp:
            temp_path = Path(temp.name)
        with zipfile.ZipFile(bundle) as source, zipfile.ZipFile(temp_path, "w") as target:
            checked_entries(source)
            target.comment = source.comment
            for entry in source.infolist():
                target.writestr(entry, signed[entry.filename] if entry.filename in signed else source.read(entry))
        with zipfile.ZipFile(bundle) as source, zipfile.ZipFile(temp_path) as target:
            if source.namelist() != target.namelist():
                raise ValueError("Repackaged ZIP entries changed")
            for name in source.namelist():
                expected = signed[name] if name in signed else source.read(name)
                if target.read(name) != expected:
                    raise ValueError(f"Repackaged ZIP content changed: {name}")
        temp_path.chmod(stat.S_IMODE(bundle.stat().st_mode))
        os.replace(temp_path, bundle)
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)


def sign_bundle(bundle, patterns, expected_fingerprint):
    bundle = bundle.resolve()
    with zipfile.ZipFile(bundle) as archive:
        selected = select_jars(archive, patterns)
        original = {name: archive.read(name) for name in selected}
    # Check the input JARs before contacting the paid signing service.
    payloads = {name: jar_payload(data) for name, data in original.items()}
    if not all(payloads.values()):
        raise ValueError("Cannot sign an empty plugin JAR")
    with tempfile.TemporaryDirectory(prefix="sslcom-", dir=os.environ.get("RUNNER_TEMP")) as temp:
        work = Path(temp).resolve()
        inputs, outputs = work / "input", work / "output"
        inputs.mkdir()
        outputs.mkdir()
        for name, data in original.items():
            (inputs / PurePosixPath(name).name).write_bytes(data)
        tool = install_tool(work / "tool")
        cloud_sign(tool, inputs, outputs)
        expected_names = {PurePosixPath(name).name for name in selected}
        if {path.name for path in outputs.iterdir()} != expected_names:
            raise ValueError("SSL.com did not return exactly the requested signed JARs")
        signed = {}
        for name in selected:
            path = outputs / PurePosixPath(name).name
            data = path.read_bytes()
            if jar_payload(data) != payloads[name]:
                raise ValueError(f"Signing changed the JAR payload: {name}")
            verify_jar(path, expected_fingerprint)
            signed[name] = data
        replace_jars(bundle, signed)
    print(f"Signed and verified {len(selected)} plugin JAR(s) in {bundle.name}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check-config", action="store_true")
    args = parser.parse_args()
    expected_fingerprint = check_config()
    if args.check_config:
        print("SSL.com signing configuration is present")
        return
    config = json.loads((HERE / "config.json").read_text())
    bundles = sorted(Path.cwd().glob(config["bundle"]))
    if len(bundles) != 1 or not bundles[0].is_file():
        raise ValueError(f"Expected exactly one release ZIP matching {config['bundle']}")
    sign_bundle(bundles[0], config["jars"], expected_fingerprint)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, zipfile.BadZipFile, subprocess.TimeoutExpired) as error:
        raise SystemExit(str(error)) from None
