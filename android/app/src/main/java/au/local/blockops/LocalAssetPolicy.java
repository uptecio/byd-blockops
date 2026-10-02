package au.local.blockops;

import java.net.URI;
import java.net.URISyntaxException;

final class LocalAssetPolicy {
    static final String INDEX_URL = "https://appassets.androidplatform.net/assets/index.html";

    static String assetName(String url) {
        if (url == null) return null;
        try {
            URI uri = new URI(url);
            if (!"https".equals(uri.getScheme())
                    || !"appassets.androidplatform.net".equals(uri.getHost())
                    || uri.getPort() != -1 || uri.getRawUserInfo() != null
                    || uri.getRawQuery() != null) return null;
            switch (uri.getRawPath()) {
                case "/assets/index.html": return "index.html";
                case "/assets/game.js": return "game.js";
                case "/assets/styles.css": return "styles.css";
                default: return null;
            }
        } catch (URISyntaxException | NullPointerException exception) {
            return null;
        }
    }

    static boolean mayNavigate(String url) {
        return "index.html".equals(assetName(url));
    }
}
