package com.novahub.app;

import android.app.Activity;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import java.lang.ref.WeakReference;

/**
 * NovaHub · 星隅 无缓存热更新主界面（支持原生全屏、状态栏媒体通知、硬件亮度音量控制与自动更新）
 */
public class MainActivity extends Activity {
    private static final String ENTRY_URL = "https://kouyibaba.github.io/novahub-web/";
    private static WeakReference<MainActivity> activeRef;
    private static final Handler mainHandler = new Handler(Looper.getMainLooper());

    private WebView webView;
    private View customView;
    private FrameLayout fullscreenContainer;
    private WebChromeClient.CustomViewCallback customViewCallback;
    private boolean jsFullscreen = false;
    private long lastBackTime = 0;

    /** 供 MediaNotifyService 回调网页端控制播放状态 */
    public static void dispatchMediaAction(final String act) {
        if (!"play_pause".equals(act) && !"prev".equals(act) && !"next".equals(act) && !"close".equals(act)) {
            return;
        }
        mainHandler.post(() -> {
            MainActivity actRef = activeRef != null ? activeRef.get() : null;
            if (actRef != null && !actRef.isFinishing() && actRef.webView != null) {
                actRef.webView.evaluateJavascript("window.__nhMediaAction && window.__nhMediaAction('" + act + "')", null);
            }
        });
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        activeRef = new WeakReference<>(this);

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
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
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

        requestNotifyPermissionOnce();
        AppUpdater.cleanupOldApks(this);
        mainHandler.postDelayed(() -> {
            if (!isFinishing()) AppUpdater.check(MainActivity.this, false);
        }, 2500);
    }

    private void requestNotifyPermissionOnce() {
        if (Build.VERSION.SDK_INT >= 33) {
            String perm = "android.permission.POST_NOTIFICATIONS";
            if (checkSelfPermission(perm) != PackageManager.PERMISSION_GRANTED) {
                SharedPreferences sp = getSharedPreferences("novahub_prefs", MODE_PRIVATE);
                if (!sp.getBoolean("asked_notify", false)) {
                    sp.edit().putBoolean("asked_notify", true).apply();
                    requestPermissions(new String[]{perm}, 101);
                }
            }
        }
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

    /** 提供给前端网页的原生控制桥（全屏、通知栏、硬件亮度、系统音量、自动更新） */
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

        @JavascriptInterface
        public void updateMediaNotification(final String title, final String artist, final boolean playing, final String mediaType) {
            MediaNotifyService.pushUpdate(MainActivity.this, title, artist, playing, mediaType);
        }

        @JavascriptInterface
        public void clearMediaNotification() {
            MediaNotifyService.clear(MainActivity.this);
        }

        @JavascriptInterface
        public void setBrightness(final float level) {
            final float clamped = Math.max(0.05f, Math.min(1.0f, level));
            runOnUiThread(() -> {
                WindowManager.LayoutParams lp = getWindow().getAttributes();
                lp.screenBrightness = clamped;
                getWindow().setAttributes(lp);
            });
        }

        @JavascriptInterface
        public float getBrightness() {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            if (lp.screenBrightness >= 0f && lp.screenBrightness <= 1f) {
                return lp.screenBrightness;
            }
            try {
                int sys = Settings.System.getInt(getContentResolver(), Settings.System.SCREEN_BRIGHTNESS, 128);
                return Math.max(0.05f, Math.min(1.0f, sys / 255f));
            } catch (Throwable e) {
                return 0.6f;
            }
        }

        @JavascriptInterface
        public void setVolume(final float level) {
            try {
                AudioManager am = (AudioManager) getSystemService(AUDIO_SERVICE);
                if (am == null) return;
                int max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
                int target = Math.max(0, Math.min(max, Math.round(level * max)));
                am.setStreamVolume(AudioManager.STREAM_MUSIC, target, 0);
            } catch (Throwable ignored) {}
        }

        @JavascriptInterface
        public float getVolume() {
            try {
                AudioManager am = (AudioManager) getSystemService(AUDIO_SERVICE);
                if (am == null) return 0.7f;
                int max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
                int cur = am.getStreamVolume(AudioManager.STREAM_MUSIC);
                return max > 0 ? ((float) cur / max) : 0.7f;
            } catch (Throwable e) {
                return 0.7f;
            }
        }

        @JavascriptInterface
        public String getAppVersion() {
            return "v" + AppUpdater.getCurrentVersionName(MainActivity.this)
                    + " (" + AppUpdater.getCurrentVersionCode(MainActivity.this) + ")";
        }

        @JavascriptInterface
        public void checkUpdate() {
            runOnUiThread(() -> AppUpdater.check(MainActivity.this, true));
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

    @Override
    protected void onDestroy() {
        MediaNotifyService.clear(this);
        super.onDestroy();
    }
}
