package com.novahub.app;

import android.app.Activity;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

/**
 * NovaHub · 星隅 无缓存套壳主界面（支持原生视频全屏横屏与沉浸式状态栏）
 */
public class MainActivity extends Activity {
    private static final String ENTRY_URL = "https://kouyibaba.github.io/novahub-web/";
    private WebView webView;
    private View customView;
    private FrameLayout fullscreenContainer;
    private WebChromeClient.CustomViewCallback customViewCallback;
    private boolean jsFullscreen = false;
    private long lastBackTime = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window window = getWindow();
        window.setStatusBarColor(Color.parseColor("#090A0D"));
        window.setNavigationBarColor(Color.parseColor("#090A0D"));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#090A0D"));
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        webView.clearCache(true);

        webView.addJavascriptInterface(new NovaBridge(), "NovaNative");
        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (customView != null) {
                    callback.onCustomViewHidden();
                    return;
                }
                customView = view;
                customViewCallback = callback;
                fullscreenContainer = new FrameLayout(MainActivity.this);
                fullscreenContainer.setBackgroundColor(Color.BLACK);
                fullscreenContainer.addView(customView, new FrameLayout.LayoutParams(-1, -1));
                ((FrameLayout) getWindow().getDecorView()).addView(fullscreenContainer,
                        new FrameLayout.LayoutParams(-1, -1));
                webView.setVisibility(View.GONE);
                applyImmersive(true);
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
            }

            @Override
            public void onHideCustomView() {
                if (customView == null) return;
                if (fullscreenContainer != null) {
                    ((FrameLayout) getWindow().getDecorView()).removeView(fullscreenContainer);
                    fullscreenContainer.removeAllViews();
                    fullscreenContainer = null;
                }
                customView = null;
                webView.setVisibility(View.VISIBLE);
                if (customViewCallback != null) {
                    customViewCallback.onCustomViewHidden();
                    customViewCallback = null;
                }
                applyImmersive(false);
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
            }
        });

        webView.loadUrl(ENTRY_URL + "?t=" + System.currentTimeMillis());
    }

    @SuppressWarnings("deprecation")
    private void applyImmersive(boolean enable) {
        View decor = getWindow().getDecorView();
        if (enable) {
            decor.setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        } else {
            decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
        }
    }

    /** 提供给前端网页的原生控制桥 */
    public class NovaBridge {
        @JavascriptInterface
        public void setFullscreen(final boolean enter) {
            runOnUiThread(() -> {
                jsFullscreen = enter;
                applyImmersive(enter);
                setRequestedOrientation(enter
                        ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                        : ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
            });
        }
    }

    @Override
    public void onBackPressed() {
        if (customView != null && webView.getWebChromeClient() != null) {
            webView.getWebChromeClient().onHideCustomView();
            return;
        }
        if (jsFullscreen) {
            jsFullscreen = false;
            applyImmersive(false);
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
            webView.evaluateJavascript("window.__nhExitFs && window.__nhExitFs()", null);
            return;
        }
        if (webView.canGoBack()) {
            webView.goBack();
            return;
        }
        long now = System.currentTimeMillis();
        if (now - lastBackTime < 2000) {
            super.onBackPressed();
        } else {
            lastBackTime = now;
            Toast.makeText(this, "再按一次退出 NovaHub", Toast.LENGTH_SHORT).show();
        }
    }
}
