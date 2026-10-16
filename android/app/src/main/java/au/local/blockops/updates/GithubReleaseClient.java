package au.local.blockops.updates;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import static au.local.blockops.updates.UpdateModel.*;

/** Native-only decoding of the fixed public repository's stable release. */
public final class GithubReleaseClient implements UpdatePorts.ReleaseSource {
    private static final int MAX_ASSETS = 256;
    private final HttpsUpdateTransport transport;

    public GithubReleaseClient(HttpsUpdateTransport transport) {
        this.transport = java.util.Objects.requireNonNull(transport);
    }

    @Override public Release latest(UpdateCancellation cancellation) throws UpdatePorts.Failure {
        HttpsUpdateTransport.Response response = transport.read(UpdatePolicy.RELEASES_URI,
                (int) UpdatePolicy.MAX_METADATA_BYTES, cancellation);
        requireSuccess(response);
        try {
            JSONObject json = new JSONObject(new String(response.bytes, StandardCharsets.UTF_8));
            long id = integer(json, "id", false);
            String tag = string(json, "tag_name", 64);
            Version version = UpdatePolicy.parseVersion(tag, true);
            boolean draft = bool(json, "draft"), prerelease = bool(json, "prerelease");
            Object rawAssets = json.get("assets");
            if (!(rawAssets instanceof JSONArray)) throw invalidRelease();
            JSONArray rows = (JSONArray) rawAssets;
            if (rows.length() == 0 || rows.length() > MAX_ASSETS) throw invalidRelease();
            List<Asset> assets = new ArrayList<>();
            Set<Long> ids = new HashSet<>();
            Asset checksum = null;
            for (int i = 0; i < rows.length(); i++) {
                Object raw = rows.get(i);
                if (!(raw instanceof JSONObject)) throw invalidRelease();
                JSONObject asset = (JSONObject) raw;
                long assetId = integer(asset, "id", false);
                if (!ids.add(assetId)) throw invalidRelease();
                String name = string(asset, "name", 1024);
                String url = string(asset, "browser_download_url", 8192);
                long size = integer(asset, "size", true);
                String digest = nullableString(asset, "digest", 128);
                Asset value = new Asset(assetId, name, URI.create(url), size, digest);
                assets.add(value);
                if ("SHA256SUMS".equals(name)) {
                    if (checksum != null || size <= 0 || size > UpdatePolicy.MAX_METADATA_BYTES) throw invalidRelease();
                    UpdatePolicy.requireInitialAssetUri(value.uri, tag, value.name);
                    checksum = value;
                }
            }
            Asset selected = UpdatePolicy.select(tag, draft, prerelease, assets);
            // Validate a present API digest before any fallback. Malformed is never "absent".
            String apiSha = selected.digest == null ? null : UpdatePolicy.digest(selected.digest, null, selected.name);
            String checksumSha = null;
            if (checksum != null) {
                HttpsUpdateTransport.Response checksums = transport.read(checksum.uri,
                        (int) UpdatePolicy.MAX_METADATA_BYTES, cancellation);
                requireSuccess(checksums);
                if (checksums.bytes.length != checksum.size) throw invalidRelease();
                checksumSha = UpdatePolicy.digest(null, new String(checksums.bytes, StandardCharsets.UTF_8), selected.name);
            }
            if ((apiSha == null && checksumSha == null)
                    || (apiSha != null && checksumSha != null && !apiSha.equals(checksumSha))) throw invalidRelease();
            String summary = nullableString(json, "body", (int) UpdatePolicy.MAX_METADATA_BYTES);
            cancellation.check();
            return new Release(id, tag, version, selected, apiSha == null ? checksumSha : apiSha,
                    UpdateModel.plainText(summary, 512));
        } catch (JSONException | IllegalArgumentException failure) {
            throw invalidRelease();
        }
    }

    private static long integer(JSONObject object, String key, boolean zeroAllowed) throws JSONException, UpdatePorts.Failure {
        Object value = object.get(key);
        if (!(value instanceof Integer) && !(value instanceof Long)) throw invalidRelease();
        long number = ((Number) value).longValue();
        if (number < (zeroAllowed ? 0 : 1)) throw invalidRelease();
        return number;
    }

    private static String string(JSONObject object, String key, int maximum) throws JSONException, UpdatePorts.Failure {
        Object value = object.get(key);
        if (!(value instanceof String) || ((String) value).length() > maximum) throw invalidRelease();
        return (String) value;
    }

    private static String nullableString(JSONObject object, String key, int maximum) throws JSONException, UpdatePorts.Failure {
        if (!object.has(key) || object.isNull(key)) return null;
        return string(object, key, maximum);
    }

    private static boolean bool(JSONObject object, String key) throws JSONException, UpdatePorts.Failure {
        Object value = object.get(key);
        if (!(value instanceof Boolean)) throw invalidRelease();
        return (Boolean) value;
    }

    private static void requireSuccess(HttpsUpdateTransport.Response response) throws UpdatePorts.Failure {
        if (response.status != 200) throw new UpdatePorts.Failure("http_error", "The update server refused the request.",
                response.serverRetryUntilWallMillis);
    }

    private static UpdatePorts.Failure invalidRelease() {
        return new UpdatePorts.Failure("invalid_release", "The release metadata failed validation.");
    }
}
