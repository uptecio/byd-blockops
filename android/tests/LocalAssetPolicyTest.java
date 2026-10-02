package au.local.blockops;

public final class LocalAssetPolicyTest {
    private static void equal(Object expected, Object actual, String message) {
        if (expected == null ? actual != null : !expected.equals(actual)) {
            throw new AssertionError(message + ": expected " + expected + ", got " + actual);
        }
    }

    public static void main(String[] args) {
        equal("index.html", LocalAssetPolicy.assetName(LocalAssetPolicy.INDEX_URL), "Entry document is served");
        equal("game.js", LocalAssetPolicy.assetName("https://appassets.androidplatform.net/assets/game.js"), "Bundled JavaScript is served");
        equal("styles.css", LocalAssetPolicy.assetName("https://appassets.androidplatform.net/assets/styles.css"), "Bundled stylesheet is served");
        String[] denied = {
            "https://example.com/assets/index.html",
            "http://appassets.androidplatform.net/assets/index.html",
            "file:///android_asset/index.html",
            "content://au.local.blockops/index.html",
            "https://appassets.androidplatform.net.evil.test/assets/index.html",
            "https://evil.test@appassets.androidplatform.net/assets/index.html",
            "https://appassets.androidplatform.net:444/assets/index.html",
            "https://appassets.androidplatform.net/assets/../index.html",
            "https://appassets.androidplatform.net/assets/%69ndex.html",
            "https://appassets.androidplatform.net/assets/unknown.js",
            "https://appassets.androidplatform.net/assets/index.html?remote=https://example.com",
            "not a URI", null
        };
        for (String url : denied) {
            equal(null, LocalAssetPolicy.assetName(url), "Unsafe URL is blocked: " + url);
            equal(false, LocalAssetPolicy.mayNavigate(url), "Unsafe navigation is blocked: " + url);
        }
        equal(true, LocalAssetPolicy.mayNavigate(LocalAssetPolicy.INDEX_URL), "Entry navigation is allowed");
        equal(true, LocalAssetPolicy.mayNavigate(LocalAssetPolicy.INDEX_URL + "#armory"), "Document fragments stay local");
        equal(false, LocalAssetPolicy.mayNavigate("https://appassets.androidplatform.net/assets/game.js"), "Scripts cannot become the document");
        System.out.println("Local asset policy tests passed.");
    }
}
