package com.novahub.app;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import java.lang.ref.WeakReference;
import java.util.UUID;
import org.json.JSONObject;

/**
 * NovaHub · 星隅 客户端主界面（支持原生全屏、歌词与进度通知栏、硬件亮度音量控制与自动更新）
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
    private boolean backNavigationPending;
    private android.window.OnBackInvokedCallback systemBackCallback;
    private NovelTtsController novelTts;
    private SessionStore sessionStore;
    private final Object sessionLock = new Object();
    private String sessionNonce = "";
    private int sessionSequence = -1;
    private boolean sessionInjected;
    private boolean pendingOpenNotifications = false;

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

    /** 供 MediaNotifyService 回调网页端拖拽跳转到指定毫秒进度 */
    public static void dispatchMediaSeek(final long posMs) {
        final long safeMs = Math.max(0L, posMs);
        mainHandler.post(() -> {
            MainActivity actRef = activeRef != null ? activeRef.get() : null;
            if (actRef != null && !actRef.isFinishing() && actRef.webView != null) {
                actRef.webView.evaluateJavascript("window.__nhMediaSeek && window.__nhMediaSeek(" + safeMs + ")", null);
            }
        });
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        activeRef = new WeakReference<>(this);
        sessionStore = new SessionStore(this);

        Window window = getWindow();
        window.setStatusBarColor(Color.parseColor("#090A0D"));
        window.setNavigationBarColor(Color.parseColor("#090A0D"));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#090A0D"));
        setContentView(webView);
        if (Build.VERSION.SDK_INT >= 33) {
            systemBackCallback = this::handleAppBack;
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, systemBackCallback);
        }
        novelTts = new NovelTtsController(this, (id, event, detail) -> {
            if (!isFinishing() && isTrustedNovelPage()) {
                webView.evaluateJavascript("window.__nhNovelTtsEvent && window.__nhNovelTtsEvent("
                        + JSONObject.quote(id) + "," + JSONObject.quote(event) + "," + JSONObject.quote(detail) + ")", null);
            }
        });

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        // 静态 JS/CSS 允许磁盘缓存加速冷启动，入口 HTML 通过时间戳实时热更新
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        webView.addJavascriptInterface(new NovaBridge(), "NovaNative");
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            if (isTrustedNovelPage() && enqueueSystemDownload(url, android.webkit.URLUtil.guessFileName(url, contentDisposition, mimeType))) {
                Toast.makeText(MainActivity.this, "已加入系统下载队列", Toast.LENGTH_SHORT).show();
            }
        });
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                synchronized (sessionLock) {
                    sessionNonce = isTrustedPageUrl(url) ? UUID.randomUUID().toString() : "";
                    sessionSequence = -1;
                    sessionInjected = false;
                }
                if (novelTts != null) novelTts.stop();
                super.onPageStarted(view, url, favicon);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (!isTrustedPageUrl(url) || !url.equals(view.getUrl())) return;
                String nonce;
                synchronized (sessionLock) {
                    if (sessionInjected) return;
                    nonce = sessionNonce;
                    sessionInjected = true;
                }
                if (nonce.isEmpty()) return;
                // Values enter only the trusted main frame via evaluateJavascript;
                // no native getter exposes credentials to arbitrary subframes.
                String saved = sessionStore.read().toString();
                view.evaluateJavascript("(function(){var sequence=0;var nonce=" + JSONObject.quote(nonce)
                        + ";var saved=JSON.parse(" + JSONObject.quote(saved) + ");"
                        + "if(typeof window.__nhNativeSessionReady==='function')window.__nhNativeSessionReady(saved,"
                        + "function(value){NovaNative.saveSession(nonce,++sequence,JSON.stringify(value));});"
                        + (pendingOpenNotifications ? "setTimeout(function(){window.__nhOpenNotifications&&window.__nhOpenNotifications();},450);" : "")
                        + "})()", null);
                pendingOpenNotifications = false;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request != null && request.isForMainFrame()) {
                    CharSequence desc = Build.VERSION.SDK_INT >= 23 && error != null ? error.getDescription() : "网络连接超时";
                    showErrorFallback(view, desc != null ? desc.toString() : "网络连接超时");
                }
            }

            @Override
            @SuppressWarnings("deprecation")
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                if (failingUrl != null && failingUrl.startsWith(ENTRY_URL)) {
                    showErrorFallback(view, description != null ? description : "网络连接超时");
                }
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                loadEntryUrl();
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage cm) {
                if (cm != null && cm.messageLevel() == ConsoleMessage.MessageLevel.ERROR) {
                    Log.e("NovaWebView", cm.message() + " (" + cm.sourceId() + ":" + cm.lineNumber() + ")");
                }
                return super.onConsoleMessage(cm);
            }

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

        loadEntryUrl();

        pendingOpenNotifications = getIntent() != null && getIntent().getBooleanExtra("open_notifications", false);
        requestNotifyPermissionOnce();
        UpdatePollService.schedule(this);
        AppUpdater.cleanupOldApks(this);
        mainHandler.postDelayed(() -> {
            if (!isFinishing()) AppUpdater.check(MainActivity.this, false);
        }, 2500);
    }

    private void loadEntryUrl() {
        if (webView != null) {
            webView.loadUrl(ENTRY_URL + "?t=" + System.currentTimeMillis());
        }
    }

    private boolean isTrustedNovelPage() {
        return webView != null && isTrustedPageUrl(webView.getUrl());
    }

    private boolean isTrustedPageUrl(String url) {
        if (url == null) return false;
        Uri uri = Uri.parse(url);
        return "https".equals(uri.getScheme()) && "kouyibaba.github.io".equals(uri.getHost())
                && (uri.getPort() == -1 || uri.getPort() == 443)
                && uri.getPath() != null && uri.getPath().startsWith("/novahub-web/");
    }

    /** 主文档加载失败时呈现可视暗黑重试页，避免纯黑屏 */
    private void showErrorFallback(WebView view, String reason) {
        String safeReason = reason.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
        String html = "<!DOCTYPE html><html><head><meta charset='utf-8'>"
                + "<meta name='viewport' content='width=device-width,initial-scale=1'></head>"
                + "<body style='margin:0;background:#090A0D;color:#E6E1D6;font-family:sans-serif;"
                + "display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;padding:24px;box-sizing:border-box;text-align:center'>"
                + "<div style='font-size:18px;font-weight:700;color:#E7C66B;margin-bottom:10px'>连接 NovaHub 失败</div>"
                + "<div style='font-size:13px;color:#8C8996;margin-bottom:22px;max-width:300px;line-height:1.6'>" + safeReason + "</div>"
                + "<button onclick=\"location.replace('" + ENTRY_URL + "?t=' + Date.now())\" "
                + "style='padding:11px 28px;border-radius:99px;border:1px solid rgba(231,198,107,0.5);"
                + "background:rgba(231,198,107,0.16);color:#F7EAD1;font-size:14px'>点击重试</button>"
                + "</body></html>";
        view.loadDataWithBaseURL(ENTRY_URL, html, "text/html", "utf-8", null);
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

    /** 提供给前端网页的原生控制桥（全屏、富媒体通知栏、硬件亮度、系统音量、自动更新） */
    public class NovaBridge {
        @JavascriptInterface
        public void saveSession(String nonce, int sequence, String payload) {
            synchronized (sessionLock) {
                if (sessionNonce.isEmpty() || !sessionNonce.equals(nonce) || sequence <= sessionSequence) return;
                try {
                    sessionStore.save(payload);
                    sessionSequence = sequence;
                } catch (Exception error) {
                    Log.w("NovaSession", "Session persistence unavailable");
                }
            }
        }

        @JavascriptInterface
        public void speakNovel(final String text, final String id, final float rate, final float pitch) {
            runOnUiThread(() -> {
                if (novelTts != null && isTrustedNovelPage()) novelTts.speak(text, id, rate, pitch);
            });
        }

        @JavascriptInterface
        public void stopNovelSpeech() {
            runOnUiThread(() -> { if (novelTts != null) novelTts.stop(); });
        }

        @JavascriptInterface
        public void openTtsSettings() {
            runOnUiThread(() -> {
                if (novelTts != null && isTrustedNovelPage()) novelTts.openSettings();
            });
        }

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
        public void updateMediaRich(final String title, final String artist, final String lyric,
                                    final String coverUrl, final boolean playing,
                                    final long positionMs, final long durationMs,
                                    final float speed, final String mediaType) {
            MediaNotifyService.pushRichUpdate(MainActivity.this, title, artist, lyric, coverUrl,
                    playing, positionMs, durationMs, speed, mediaType);
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

        @JavascriptInterface
        public boolean downloadMedia(final String url, final String filename) {
            if (!isTrustedNovelPage()) return false;
            return enqueueSystemDownload(url, filename);
        }
    }

    private boolean enqueueSystemDownload(String url, String rawFilename) {
        if (url == null || (!url.startsWith("https://") && !url.startsWith("http://"))) {
            return false;
        }
        try {
            DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
            if (dm == null) return false;
            String safeName = (rawFilename == null ? "novahub-media" : rawFilename)
                    .replaceAll("[\\\\/:*?\"<>|\\r\\n]+", "_").trim();
            if (safeName.isEmpty()) safeName = "novahub-media";
            DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
            req.setTitle(safeName);
            req.setDescription("NovaHub 媒体下载");
            req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            req.setAllowedOverMetered(true);
            req.setAllowedOverRoaming(true);
            try {
                req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "NovaHub/" + safeName);
            } catch (Throwable ignored) {
                req.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, safeName);
            }
            dm.enqueue(req);
            return true;
        } catch (Throwable e) {
            Log.w("NovaDownload", "Download enqueue failed", e);
            return false;
        }
    }

    @Override
    protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent != null && intent.getBooleanExtra("open_notifications", false)) {
            if (webView != null && isTrustedNovelPage()) {
                webView.evaluateJavascript("window.__nhOpenNotifications && window.__nhOpenNotifications()", null);
            } else {
                pendingOpenNotifications = true;
            }
        }
    }

    @Override
    public void onBackPressed() {
        handleAppBack();
    }

    private void handleAppBack() {
        if (backNavigationPending || isFinishing()) return;
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
        if (isTrustedNovelPage()) {
            backNavigationPending = true;
            webView.evaluateJavascript("(function(){if(typeof window.__nhHandleBack!=='function')return 'legacy';"
                    + "return window.__nhHandleBack()?'handled':'root';})()", result -> {
                backNavigationPending = false;
                if (isFinishing()) return;
                if ("\"handled\"".equals(result)) {
                    lastBackTime = 0;
                } else if ("\"root\"".equals(result)) {
                    confirmExit();
                } else {
                    handleLegacyBack();
                }
            });
            return;
        }
        handleLegacyBack();
    }

    private void handleLegacyBack() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        confirmExit();
    }

    private void confirmExit() {
        long now = System.currentTimeMillis();
        if (now - lastBackTime < 2000) {
            finish();
        } else {
            lastBackTime = now;
            Toast.makeText(this, "再按一次退出 NovaHub", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onDestroy() {
        if (Build.VERSION.SDK_INT >= 33 && systemBackCallback != null) {
            getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(systemBackCallback);
        }
        if (novelTts != null) novelTts.shutdown();
        MediaNotifyService.clear(this);
        super.onDestroy();
    }
}
