package au.local.blockops.updates;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import static au.local.blockops.updates.UpdateModel.*;

/** Pure validation of release metadata, network destinations and APK identities. */
public final class UpdatePolicy {
    public static final String PACKAGE_NAME = "au.local.blockops";
    public static final String SIGNER_SHA256 = "6b2d84eb4133168fec0850ed710acffa01d8399b75c8410621b2d0ce9881cb49";
    public static final URI RELEASES_URI = URI.create("https://api.github.com/repos/uptecio/byd-blockops/releases/latest");
    public static final long MAX_METADATA_BYTES = 512L * 1024;
    public static final long MAX_APK_BYTES = 100L * 1024 * 1024;
    public static final int MAX_REDIRECTS = 5;
    private static final Pattern VERSION = Pattern.compile("(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)");
    private static final Pattern DIGEST = Pattern.compile("sha256:([a-fA-F0-9]{64})");
    private static final Pattern CHECKSUM = Pattern.compile("([a-fA-F0-9]{64})[ \\t]+\\*?([^\\r\\n]+)");
    private static final Pattern ENCODED_PATH = Pattern.compile("%(?:2e|2f|5c|25)", Pattern.CASE_INSENSITIVE);
    private static final Set<String> HOSTS = new HashSet<>(Arrays.asList("api.github.com", "github.com",
            "release-assets.githubusercontent.com", "objects.githubusercontent.com"));

    private UpdatePolicy() {}

    public static final class PolicyFailure extends IllegalArgumentException {
        public final String code;
        private PolicyFailure(String code, String message) { super(message); this.code = code; }
    }

    public static Version parseVersion(String value, boolean tag) {
        if (value == null || (tag && !value.startsWith("v"))) throw invalidVersion();
        Matcher match = VERSION.matcher(tag ? value.substring(1) : value);
        if (!match.matches()) throw invalidVersion();
        try {
            return new Version(Integer.parseInt(match.group(1)), Integer.parseInt(match.group(2)),
                    Integer.parseInt(match.group(3)));
        } catch (NumberFormatException overflow) {
            throw invalidVersion();
        }
    }

    public static int compare(Version left, Version right) {
        if (left == null || right == null) throw invalidVersion();
        int result = Integer.compare(left.major, right.major);
        if (result == 0) result = Integer.compare(left.minor, right.minor);
        return result == 0 ? Integer.compare(left.patch, right.patch) : result;
    }

    public static Asset select(String tag, boolean draft, boolean prerelease, List<Asset> assets) {
        parseVersion(tag, true);
        if (draft || prerelease || assets == null) throw invalidRelease();
        Asset selected = null;
        for (Asset asset : assets) {
            if (asset == null || asset.name == null) throw invalidRelease();
            if (asset.name.startsWith("block-ops-") && asset.name.endsWith(".apk")) {
                if (selected != null || !asset.name.matches("block-ops-[A-Za-z0-9][A-Za-z0-9._-]*\\.apk")
                        || asset.id <= 0 || asset.size <= 0 || asset.size > MAX_APK_BYTES) throw invalidRelease();
                requireInitialAssetUri(asset.uri, tag, asset.name);
                selected = asset;
            }
        }
        if (selected == null) throw invalidRelease();
        return selected;
    }

    public static void requireInitialAssetUri(URI uri, String tag, String filename) {
        parseVersion(tag, true);
        requireRedirectUri(uri, 0);
        if (filename == null || !filename.matches("[A-Za-z0-9][A-Za-z0-9._-]*")
                || !"github.com".equalsIgnoreCase(uri.getHost()) || uri.getRawQuery() != null
                || !uri.getRawPath().equals("/uptecio/byd-blockops/releases/download/" + tag + "/" + filename)) {
            throw unsafeUri();
        }
    }

    public static void requireRedirectUri(URI uri, int hops) {
        if (uri == null || hops < 0 || hops > MAX_REDIRECTS || !"https".equalsIgnoreCase(uri.getScheme())
                || uri.isOpaque() || uri.getHost() == null || !HOSTS.contains(uri.getHost().toLowerCase(Locale.ROOT))
                || uri.getRawUserInfo() != null || uri.getRawFragment() != null
                || (uri.getPort() != -1 && uri.getPort() != 443)) throw unsafeUri();
        String path = uri.getRawPath();
        if (path == null || !path.startsWith("/") || path.indexOf('\\') >= 0
                || ENCODED_PATH.matcher(path).find()) throw unsafeUri();
        for (String segment : path.split("/", -1)) {
            if (segment.equals(".") || segment.equals("..")) throw unsafeUri();
        }
    }

    public static String digest(String apiDigest, String checksumText, String filename) {
        if (apiDigest != null) {
            Matcher match = DIGEST.matcher(apiDigest);
            if (!match.matches()) throw invalidDigest();
            return match.group(1).toLowerCase(Locale.ROOT);
        }
        if (checksumText == null || checksumText.length() > MAX_METADATA_BYTES || filename == null
                || checksumText.getBytes(StandardCharsets.UTF_8).length > MAX_METADATA_BYTES) throw invalidDigest();
        String selected = null;
        for (String row : checksumText.split("\\r?\\n", -1)) {
            if (row.isEmpty()) continue;
            Matcher match = CHECKSUM.matcher(row);
            if (!match.matches()) throw invalidDigest();
            if (filename.equals(match.group(2))) {
                if (selected != null) throw invalidDigest();
                selected = match.group(1).toLowerCase(Locale.ROOT);
            }
        }
        if (selected == null) throw invalidDigest();
        return selected;
    }

    public static void requireIdentity(Release release, InstalledApp installed, ApkIdentity apk) {
        if (release == null || installed == null || apk == null
                || !PACKAGE_NAME.equals(installed.packageName) || !PACKAGE_NAME.equals(apk.packageName)
                || !SIGNER_SHA256.equalsIgnoreCase(installed.signerSha256) || !SIGNER_SHA256.equalsIgnoreCase(apk.signerSha256)
                || installed.versionCode < 0 || apk.versionCode <= installed.versionCode
                || apk.minSdk <= 0 || apk.minSdk > installed.sdkInt
                || compare(parseVersion(release.tag, true), release.version) != 0
                || compare(parseVersion(apk.versionName, false), release.version) != 0
                || compare(release.version, parseVersion(installed.versionName, false)) <= 0) {
            throw new PolicyFailure("invalid_identity", "The APK cannot safely upgrade this app.");
        }
    }

    private static PolicyFailure invalidVersion() { return new PolicyFailure("invalid_version", "Invalid release version."); }
    private static PolicyFailure invalidRelease() { return new PolicyFailure("invalid_release", "No unique supported release APK."); }
    private static PolicyFailure unsafeUri() { return new PolicyFailure("unsafe_url", "Untrusted update destination."); }
    private static PolicyFailure invalidDigest() { return new PolicyFailure("invalid_digest", "No valid unique APK checksum."); }
}
