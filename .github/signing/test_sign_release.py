"""Offline release-signing regression tests; never uses SSL.com credentials."""

from contextlib import contextmanager
import hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch
import zipfile

import sign_release as signing

VERIFY_JAR = signing.verify_jar


def zip_bytes(entries):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as archive:
        for name, data in entries.items():
            archive.writestr(name, data)
    return stream.getvalue()


def command(*args, cwd):
    result = subprocess.run(args, cwd=cwd, capture_output=True, timeout=60)
    if result.returncode:
        raise RuntimeError(result.stdout.decode(errors="replace") + result.stderr.decode(errors="replace"))
    return result.stdout


@contextmanager
def timestamp_server(root):
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            request = self.rfile.read(int(self.headers["Content-Length"]))
            (root / "request.tsq").write_bytes(request)
            result = subprocess.run(
                ["openssl", "ts", "-reply", "-config", "tsa.cnf", "-queryfile", "request.tsq"],
                cwd=root, capture_output=True, timeout=30)
            self.send_response(200 if result.returncode == 0 else 500)
            self.send_header("Content-Type", "application/timestamp-reply")
            self.end_headers()
            self.wfile.write(result.stdout)

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


class SigningTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="sslcom-tests-")
        cls.addClassCleanup(cls.temp.cleanup)
        cls.root = root = Path(cls.temp.name)
        command("openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
                "-subj", "/CN=Signing Test Root", "-days", "2", "-keyout", "root.key",
                "-out", "root.crt", "-addext", "basicConstraints=critical,CA:TRUE", cwd=root)
        for index, (name, eku) in enumerate((("signer", "codeSigning"), ("tsa", "critical,timeStamping")), 2):
            command("openssl", "req", "-new", "-newkey", "rsa:2048", "-nodes",
                    "-subj", f"/CN=Test {name}", "-keyout", f"{name}.key", "-out", f"{name}.csr", cwd=root)
            (root / f"{name}.ext").write_text(
                "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\n"
                f"extendedKeyUsage={eku}\n")
            command("openssl", "x509", "-req", "-in", f"{name}.csr", "-CA", "root.crt",
                    "-CAkey", "root.key", "-set_serial", str(index), "-days", "2",
                    "-extfile", f"{name}.ext", "-out", f"{name}.crt", cwd=root)
        command("openssl", "pkcs12", "-export", "-in", "signer.crt", "-inkey", "signer.key",
                "-certfile", "root.crt", "-name", "signer", "-out", "signer.p12",
                "-passout", "pass:changeit", cwd=root)
        command("keytool", "-importcert", "-noprompt", "-alias", "root", "-file", "root.crt",
                "-keystore", "trust.p12", "-storepass", "changeit", cwd=root)
        der = command("openssl", "x509", "-in", "signer.crt", "-outform", "DER", cwd=root)
        cls.fingerprint = hashlib.sha256(der).hexdigest()
        (root / "tsa.serial").write_text("01\n")
        (root / "tsa.cnf").write_text("""[tsa]
default_tsa = tsa_config
[tsa_config]
serial = tsa.serial
crypto_device = builtin
signer_cert = tsa.crt
certs = root.crt
signer_key = tsa.key
signer_digest = sha256
default_policy = 1.2.3.4.1
digests = sha256,sha384,sha512
accuracy = secs:1
ordering = yes
tsa_name = yes
ess_cert_id_chain = yes
ess_cert_id_alg = sha256
""")
        cls.unsigned = zip_bytes({"payload.txt": b"original payload", "META-INF/services/test": b"provider"})
        (root / "unsigned.jar").write_bytes(cls.unsigned)
        with timestamp_server(root) as tsa:
            command("jarsigner", "-keystore", "signer.p12", "-storepass", "changeit",
                    "-tsa", tsa, "-signedjar", "signed.jar", "unsigned.jar", "signer", cwd=root)
        cls.signed = (root / "signed.jar").read_bytes()
        command("jarsigner", "-keystore", "signer.p12", "-storepass", "changeit",
                "-signedjar", "no-timestamp.jar", "unsigned.jar", "signer", cwd=root)

    def setUp(self):
        self.work = tempfile.TemporaryDirectory(prefix="sslcom-case-")
        self.addCleanup(self.work.cleanup)
        self.bundle = Path(self.work.name) / "plugin.zip"
        self.bundle.write_bytes(zip_bytes({
            "plugin/plugin.xml": b"<plugin/>", "plugin/one.jar": self.unsigned,
            "plugin/two.jar": self.unsigned, "plugin/vendor.jar": b"vendor bytes",
            "plugin/webadmin.war": b"published WAR bytes", "plugin/web/plugin.js": b"web bytes",
        }))
        self.patterns = ["plugin/one.jar", "plugin/two.jar"]
        self.original = self.bundle.read_bytes()

    def verify(self, path, fingerprint=None):
        VERIFY_JAR(path, fingerprint or self.fingerprint, truststore=self.root / "trust.p12")

    def test_real_signed_timestamped_jar(self):
        self.verify(self.root / "signed.jar")

    def test_unsigned_jar_rejected(self):
        with self.assertRaisesRegex(ValueError, "verification failed"):
            self.verify(self.root / "unsigned.jar")

    def test_missing_timestamp_rejected(self):
        with self.assertRaisesRegex(ValueError, "Missing trusted timestamp"):
            self.verify(self.root / "no-timestamp.jar")

    def test_wrong_certificate_rejected(self):
        with self.assertRaisesRegex(ValueError, "Unexpected signing certificate"):
            self.verify(self.root / "signed.jar", "0" * 64)

    def test_untrusted_certificate_rejected(self):
        with self.assertRaisesRegex(ValueError, "trust/signature verification failed"):
            signing.verify_jar(self.root / "signed.jar", self.fingerprint)

    def test_tampered_payload_rejected(self):
        path = Path(self.work.name) / "tampered.jar"
        with zipfile.ZipFile(io.BytesIO(self.signed)) as archive:
            entries = {name: archive.read(name) for name in archive.namelist()}
        entries["payload.txt"] = b"tampered"
        path.write_bytes(zip_bytes(entries))
        with self.assertRaisesRegex(ValueError, "verification failed"):
            self.verify(path)

    def test_unsigned_added_resource_rejected(self):
        path = Path(self.work.name) / "partial.jar"
        path.write_bytes(self.signed)
        with zipfile.ZipFile(path, "a") as archive:
            archive.writestr("META-INF/services/unsigned-provider", b"unsigned")
        with self.assertRaisesRegex(ValueError, "verification failed"):
            self.verify(path)

    def test_signed_bundle_preserves_other_entries(self):
        def sign(_tool, inputs, outputs):
            for path in inputs.iterdir():
                (outputs / path.name).write_bytes(self.signed)
        with patch.object(signing, "install_tool", return_value=Path("unused")), \
                patch.object(signing, "cloud_sign", side_effect=sign), \
                patch.object(signing, "verify_jar", side_effect=self.verify):
            signing.sign_bundle(self.bundle, self.patterns, self.fingerprint)
        with zipfile.ZipFile(io.BytesIO(self.original)) as before, zipfile.ZipFile(self.bundle) as after:
            self.assertEqual(before.namelist(), after.namelist())
            for name in before.namelist():
                self.assertEqual(after.read(name), self.signed if name in self.patterns else before.read(name))

    def test_partial_batch_leaves_original_bundle(self):
        def sign(_tool, _inputs, outputs):
            (outputs / "one.jar").write_bytes(self.signed)
        with patch.object(signing, "install_tool", return_value=Path("unused")), \
                patch.object(signing, "cloud_sign", side_effect=sign):
            with self.assertRaisesRegex(ValueError, "exactly the requested"):
                signing.sign_bundle(self.bundle, self.patterns, self.fingerprint)
        self.assertEqual(self.bundle.read_bytes(), self.original)

    def test_success_exit_with_unsigned_files_leaves_original_bundle(self):
        def sign(_tool, inputs, outputs):
            for path in inputs.iterdir():
                shutil.copyfile(path, outputs / path.name)
        with patch.object(signing, "install_tool", return_value=Path("unused")), \
                patch.object(signing, "cloud_sign", side_effect=sign), \
                patch.object(signing, "verify_jar", side_effect=self.verify):
            with self.assertRaisesRegex(ValueError, "verification failed"):
                signing.sign_bundle(self.bundle, self.patterns, self.fingerprint)
        self.assertEqual(self.bundle.read_bytes(), self.original)

    def test_second_jar_failure_does_not_commit_first(self):
        def sign(_tool, _inputs, outputs):
            (outputs / "one.jar").write_bytes(self.signed)
            (outputs / "two.jar").write_bytes(self.unsigned)
        with patch.object(signing, "install_tool", return_value=Path("unused")), \
                patch.object(signing, "cloud_sign", side_effect=sign), \
                patch.object(signing, "verify_jar", side_effect=self.verify):
            with self.assertRaisesRegex(ValueError, "verification failed"):
                signing.sign_bundle(self.bundle, self.patterns, self.fingerprint)
        self.assertEqual(self.bundle.read_bytes(), self.original)

    def test_changed_payload_rejected_before_repacking(self):
        def sign(_tool, _inputs, outputs):
            (outputs / "one.jar").write_bytes(zip_bytes({"payload.txt": b"changed"}))
            (outputs / "two.jar").write_bytes(self.signed)
        with patch.object(signing, "install_tool", return_value=Path("unused")), \
                patch.object(signing, "cloud_sign", side_effect=sign):
            with self.assertRaisesRegex(ValueError, "changed the JAR payload"):
                signing.sign_bundle(self.bundle, self.patterns, self.fingerprint)
        self.assertEqual(self.bundle.read_bytes(), self.original)

    def test_extra_output_rejected_before_repacking(self):
        def sign(_tool, _inputs, outputs):
            for name in ["one.jar", "two.jar", "unexpected.jar"]:
                (outputs / name).write_bytes(self.signed)
        with patch.object(signing, "install_tool", return_value=Path("unused")), \
                patch.object(signing, "cloud_sign", side_effect=sign):
            with self.assertRaisesRegex(ValueError, "exactly the requested"):
                signing.sign_bundle(self.bundle, self.patterns, self.fingerprint)
        self.assertEqual(self.bundle.read_bytes(), self.original)

    def test_cloud_failure_preserves_bundle_and_cleans_working_directory(self):
        root = Path(self.work.name) / "runner-temp"
        root.mkdir()
        with patch.dict(os.environ, {"RUNNER_TEMP": str(root)}), \
                patch.object(signing, "install_tool", return_value=Path("unused")), \
                patch.object(signing, "cloud_sign", side_effect=ValueError("service unavailable")):
            with self.assertRaisesRegex(ValueError, "service unavailable"):
                signing.sign_bundle(self.bundle, self.patterns, self.fingerprint)
        self.assertEqual(list(root.iterdir()), [])
        self.assertEqual(self.bundle.read_bytes(), self.original)

    def test_repack_failure_is_atomic(self):
        with patch.object(signing.os, "replace", side_effect=OSError("disk failure")):
            with self.assertRaisesRegex(OSError, "disk failure"):
                signing.replace_jars(self.bundle, {"plugin/one.jar": self.signed})
        self.assertEqual(self.bundle.read_bytes(), self.original)
        self.assertEqual(list(self.bundle.parent.glob("*.signed.zip")), [])

    def test_missing_and_ambiguous_jar_selection(self):
        for patterns in (["plugin/missing.jar"], ["plugin/*.jar"], [], ["plugin/one.jar"] * 2):
            with self.subTest(patterns=patterns), zipfile.ZipFile(self.bundle) as archive:
                with self.assertRaises(ValueError):
                    signing.select_jars(archive, patterns)

    def test_unsafe_and_duplicate_zip_entries_rejected(self):
        for names in (["../escape.jar"], ["/absolute.jar"], ["a.jar", "a.jar"]):
            with self.subTest(names=names):
                data = io.BytesIO()
                with zipfile.ZipFile(data, "w") as archive:
                    for name in names:
                        archive.writestr(name, self.unsigned)
                with zipfile.ZipFile(data) as archive, self.assertRaises(ValueError):
                    signing.select_jars(archive, ["*.jar"])

    def test_missing_secrets_and_invalid_fingerprint(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(ValueError, "Missing GitHub Actions secrets"):
                signing.check_config()
        env = {name: "fixture-only" for name in signing.SECRET_NAMES}
        with patch.dict(os.environ, env, clear=True):
            with self.assertRaisesRegex(ValueError, "SSL_COM_CERT_SHA256"):
                signing.check_config()
        env["SSL_COM_CERT_SHA256"] = ":".join(["AB"] * 32)
        with patch.dict(os.environ, env, clear=True):
            self.assertEqual(signing.check_config(), "ab" * 32)

    def test_tool_digest_mismatch_rejected(self):
        with patch.object(signing.urllib.request, "urlopen", return_value=io.BytesIO(b"wrong binary")):
            with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
                signing.install_tool(Path(self.work.name) / "tool")

    def test_credentials_are_literal_arguments_and_not_error_output(self):
        env = {name: 'sensitive " $() ` value' for name in signing.SECRET_NAMES}
        env['CODESIGNTOOL_JAVA'] = '/private/java11/bin/java'
        with patch.dict(os.environ, env), patch.object(signing.subprocess, "run") as run:
            run.return_value.returncode = 1
            run.return_value.stdout = b"a sensitive access token"
            with self.assertRaises(ValueError) as error:
                signing.cloud_sign(Path("/tmp/tool/jar/tool.jar"), Path("/tmp/in"), Path("/tmp/out"))
            self.assertNotIn("sensitive", str(error.exception))
            self.assertEqual(run.call_args.args[0][0], env["CODESIGNTOOL_JAVA"])
            self.assertIn("-password=" + env["SSL_COM_PASSWORD"], run.call_args.args[0])
            self.assertFalse(run.call_args.kwargs.get("shell", False))

    def test_missing_tool_runtime_fails_before_cloud_request(self):
        for value in ("", "java", "relative/java"):
            with self.subTest(value=value), patch.dict(os.environ, {"CODESIGNTOOL_JAVA": value}), \
                    patch.object(signing.subprocess, "run") as run:
                with self.assertRaisesRegex(ValueError, "JDK 11"):
                    signing.cloud_sign(Path("unused"), Path("in"), Path("out"))
                run.assert_not_called()

    def test_zero_exit_with_service_error_is_rejected_without_leaking_output(self):
        inputs, outputs = Path(self.work.name) / "inputs", Path(self.work.name) / "outputs"
        inputs.mkdir()
        outputs.mkdir()
        (inputs / "one.jar").write_bytes(self.unsigned)
        env = {name: "fixture-only" for name in signing.SECRET_NAMES}
        env["CODESIGNTOOL_JAVA"] = "/private/java11/bin/java"
        with patch.dict(os.environ, env), patch.object(signing.subprocess, "run") as run:
            run.return_value.returncode = 0
            run.return_value.stdout = b"access_token=private-response-token\nError: invalid otp"
            with self.assertRaisesRegex(ValueError, "invalid signing OTP") as error:
                signing.cloud_sign(Path("/tmp/tool/jar/tool.jar"), inputs, outputs)
            self.assertNotIn("private-response-token", str(error.exception))
            self.assertNotIn("access_token", str(error.exception))
            self.assertEqual(run.call_count, 1)

    def test_unrecognized_zero_exit_failure_does_not_leak_vendor_output(self):
        inputs, outputs = Path(self.work.name) / "inputs", Path(self.work.name) / "outputs"
        inputs.mkdir()
        outputs.mkdir()
        (inputs / "one.jar").write_bytes(self.unsigned)
        env = {name: "fixture-only" for name in signing.SECRET_NAMES}
        env["CODESIGNTOOL_JAVA"] = "/private/java11/bin/java"
        with patch.dict(os.environ, env), patch.object(signing.subprocess, "run") as run:
            run.return_value.returncode = 0
            run.return_value.stdout = b"private-unrecognized-vendor-response"
            with self.assertRaisesRegex(ValueError, "SSL.com signing failed") as error:
                signing.cloud_sign(Path("/tmp/tool/jar/tool.jar"), inputs, outputs)
            self.assertNotIn("private-unrecognized-vendor-response", str(error.exception))
            self.assertEqual(run.call_count, 1)

    def test_release_workflow_orders_signing_before_publication(self):
        workflow = (signing.HERE.parent / "workflows/release.yml").read_text()
        self.assertIn("if: startsWith(github.ref, 'refs/tags/v')", workflow)
        preflight = workflow.index("sign_release.py --check-config")
        self.assertIn("steps.codesign-java.outputs.path", workflow)
        self.assertIn("sign_release.py --check-tool", workflow)
        sign = workflow.index("run: python3 .github/signing/sign_release.py\n")
        publish = workflow.index("uses: softprops/action-gh-release@")
        self.assertLess(preflight, sign)
        self.assertLess(sign, publish)
        if "sha256sum" in workflow[sign:]:
            self.assertLess(sign, workflow.index("sha256sum", sign))
        config = json.loads((signing.HERE / "config.json").read_text())
        self.assertTrue(config["bundle"].endswith(".zip"))
        self.assertTrue(config["jars"])


if __name__ == "__main__":
    unittest.main()
