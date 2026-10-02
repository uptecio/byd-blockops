package au.local.blockops;

import android.app.Activity;
import android.annotation.SuppressLint;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.DisplayCutout;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.window.OnBackInvokedDispatcher;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

public final class MainActivity extends Activity {
    private FrameLayout root;
    private WebView gameView;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams attributes = getWindow().getAttributes();
            attributes.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(attributes);
        }
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(16, 44, 70));
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 28) {
                DisplayCutout cutout = insets.getDisplayCutout();
                view.setPadding(cutout == null ? 0 : cutout.getSafeInsetLeft(),
                        cutout == null ? 0 : cutout.getSafeInsetTop(),
                        cutout == null ? 0 : cutout.getSafeInsetRight(),
                        cutout == null ? 0 : cutout.getSafeInsetBottom());
            }
            return Build.VERSION.SDK_INT >= 30 ? WindowInsets.CONSUMED : insets.consumeSystemWindowInsets();
        });
        setContentView(root);
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::pauseGame);
        }
        createGameView();
        hideSystemBars();
    }

    @SuppressWarnings("deprecation")
    private void createGameView() {
        gameView = new WebView(this);
        gameView.setBackgroundColor(Color.rgb(16, 44, 70));
        WebSettings settings = gameView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setBlockNetworkLoads(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        gameView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !"GET".equals(request.getMethod())
                        || !LocalAssetPolicy.mayNavigate(request.getUrl().toString());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return !LocalAssetPolicy.mayNavigate(url);
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return serveAsset(request.getUrl().toString(), request.getMethod());
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    showFailure("The game could not be loaded. Try reopening it.");
                }
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame()) {
                    showFailure("The packaged game files could not be loaded. Try reopening it.");
                }
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                showFailure("The graphics renderer stopped. Tap Reopen game to return to the menu.");
                return true;
            }
        });
        root.addView(gameView, new FrameLayout.LayoutParams(-1, -1));
        gameView.loadUrl(LocalAssetPolicy.INDEX_URL);
    }

    private WebResourceResponse serveAsset(String url, String method) {
        String name = "GET".equals(method) ? LocalAssetPolicy.assetName(url) : null;
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        headers.put("X-Content-Type-Options", "nosniff");
        headers.put("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src wss:; object-src 'none'; base-uri 'none'; frame-src 'none'");
        if (name != null) {
            String mime = name.endsWith(".js") ? "application/javascript"
                    : name.endsWith(".css") ? "text/css" : "text/html";
            try {
                return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers, getAssets().open(name));
            } catch (IOException ignored) {
                // Missing packaged files get a local failure rather than a network request.
            }
        }
        return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", headers,
                new ByteArrayInputStream("Local game asset unavailable".getBytes(StandardCharsets.UTF_8)));
    }

    private void pauseGame() {
        if (gameView != null) {
            gameView.evaluateJavascript("if (typeof window.pauseGame === 'function') { window.pauseGame(); }", null);
        }
    }

    @Override
    protected void onPause() {
        pauseGame();
        // onPause suspends rendering, not JavaScript. Do not pauseTimers here:
        // the queued pauseGame evaluation must still be able to clear input.
        if (gameView != null) gameView.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (gameView != null) gameView.onResume();
        hideSystemBars();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
        else pauseGame();
    }

    @Override
    @SuppressWarnings("deprecation")
    // API 33+ uses the native OnBackInvokedCallback registered in onCreate.
    @SuppressLint("GestureBackNavigation")
    public void onBackPressed() {
        pauseGame();
    }

    @SuppressWarnings("deprecation")
    private void hideSystemBars() {
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.systemBars());
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
    }

    private void showFailure(String message) {
        if (gameView != null) {
            root.removeView(gameView);
            gameView.destroy();
            gameView = null;
        }
        root.removeAllViews();
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER);
        panel.setPadding(48, 24, 48, 24);
        TextView text = new TextView(this);
        text.setText(message);
        text.setTextColor(Color.WHITE);
        text.setTextSize(20);
        text.setGravity(Gravity.CENTER);
        panel.addView(text);
        Button retry = new Button(this);
        retry.setText("Reopen game");
        retry.setOnClickListener(view -> recreate());
        panel.addView(retry);
        root.addView(panel, new FrameLayout.LayoutParams(-1, -1));
    }

    @Override
    protected void onDestroy() {
        if (gameView != null) {
            root.removeView(gameView);
            gameView.destroy();
            gameView = null;
        }
        super.onDestroy();
    }
}
