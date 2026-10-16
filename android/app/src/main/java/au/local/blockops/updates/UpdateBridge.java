package au.local.blockops.updates;

import android.webkit.JavascriptInterface;
import java.util.concurrent.Executor;
import java.util.function.Consumer;
import org.json.JSONException;
import org.json.JSONObject;
import static au.local.blockops.updates.UpdateModel.Snapshot;

/** Three requests only. The Activity validates the current document and foreground on main. */
public final class UpdateBridge {
    private final Executor main;
    private final Consumer<String> request;
    public UpdateBridge(Executor main, Consumer<String> request) { this.main=main; this.request=request; }
    @JavascriptInterface public void homeState(String state) {
        if ("home".equals(state)||"hidden".equals(state)) main.execute(()->request.accept(state));
    }
    @JavascriptInterface public void check() { main.execute(()->request.accept("check")); }
    @JavascriptInterface public void open() { main.execute(()->request.accept("open")); }

    public static String script(Snapshot state) {
        try {
            JSONObject json=new JSONObject();
            json.put("revision",state.revision);json.put("phase",state.phase);json.put("installedVersion",state.installedVersion);
            json.put("availableVersion",state.availableVersion==null?JSONObject.NULL:state.availableVersion);
            json.put("totalBytes",state.totalBytes);json.put("downloadedBytes",state.downloadedBytes);
            json.put("message",state.message);json.put("dismissed",state.dismissed);
            // JSON permits these literal characters; pre-ES2019 JavaScript string literals do not.
            String argument=json.toString().replace("\u2028","\\u2028").replace("\u2029","\\u2029");
            return "if(typeof window.receiveBlockOpsUpdate==='function'){window.receiveBlockOpsUpdate("+argument+");}";
        } catch(JSONException impossible) { throw new IllegalArgumentException("Invalid updater snapshot",impossible); }
    }
}
