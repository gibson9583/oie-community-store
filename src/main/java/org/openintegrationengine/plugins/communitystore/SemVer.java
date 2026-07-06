/*
 * OIE Community Store
 *
 * Published under the terms of the Mozilla Public License 2.0.
 */

package org.openintegrationengine.plugins.communitystore;

/**
 * Minimal semantic version support: parse, compare, and range checks. Tolerates a leading "v"
 * and ignores build metadata. A missing component is treated as zero, so "4.6" equals "4.6.0".
 * Pre-release identifiers sort before the release per semver ("1.0.0-rc.1" < "1.0.0").
 */
public final class SemVer implements Comparable<SemVer> {

    private final int major;
    private final int minor;
    private final int patch;
    private final String preRelease;

    private SemVer(int major, int minor, int patch, String preRelease) {
        this.major = major;
        this.minor = minor;
        this.patch = patch;
        this.preRelease = preRelease;
    }

    public static SemVer parse(String value) {
        if (value == null) {
            return null;
        }
        String v = value.trim();
        if (v.startsWith("v") || v.startsWith("V")) {
            v = v.substring(1);
        }
        int plus = v.indexOf('+');
        if (plus >= 0) {
            v = v.substring(0, plus);
        }
        String pre = null;
        int dash = v.indexOf('-');
        if (dash >= 0) {
            pre = v.substring(dash + 1);
            v = v.substring(0, dash);
        }
        String[] parts = v.split("\\.");
        try {
            int major = parts.length > 0 && !parts[0].isEmpty() ? Integer.parseInt(parts[0]) : 0;
            int minor = parts.length > 1 ? Integer.parseInt(parts[1]) : 0;
            int patch = parts.length > 2 ? Integer.parseInt(parts[2]) : 0;
            return new SemVer(major, minor, patch, pre);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /** True when {@code version} lies inside [min, max]; null bounds are open. */
    public static boolean inRange(SemVer version, SemVer min, SemVer max) {
        if (version == null) {
            return false;
        }
        if (min != null && version.compareTo(min) < 0) {
            return false;
        }
        if (max != null && version.compareTo(max) > 0) {
            return false;
        }
        return true;
    }

    @Override
    public int compareTo(SemVer other) {
        if (major != other.major) {
            return Integer.compare(major, other.major);
        }
        if (minor != other.minor) {
            return Integer.compare(minor, other.minor);
        }
        if (patch != other.patch) {
            return Integer.compare(patch, other.patch);
        }
        // A pre-release sorts before its release; two pre-releases compare lexically (good enough here).
        if (preRelease == null && other.preRelease == null) {
            return 0;
        }
        if (preRelease == null) {
            return 1;
        }
        if (other.preRelease == null) {
            return -1;
        }
        return preRelease.compareTo(other.preRelease);
    }

    @Override
    public String toString() {
        return major + "." + minor + "." + patch + (preRelease != null ? "-" + preRelease : "");
    }
}
