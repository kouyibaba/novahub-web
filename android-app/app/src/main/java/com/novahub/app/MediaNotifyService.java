package com.novahub.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.Icon;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.lang.ref.WeakReference;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 原生前台媒体通知与锁屏 MediaSession 控制服务（支持歌词展示、总时长、进度条拖动与专辑封面）
 */
public class MediaNotifyService extends Service {
    public static final String ACTION_UPDATE = "com.novahub.app.MEDIA_UPDATE";
    public static final String ACTION_CMD = "com.novahub.app.MEDIA_CMD";
    private static final String CH_ID = "novahub_media";
    private static final int NOTIFY_ID = 1001;

    private static volatile WeakReference<MediaNotifyService> activeInstance;
    private static final Handler mainHandler = new Handler(Looper.getMainLooper());
    private static final ExecutorService coverExecutor = Executors.newSingleThreadExecutor();

    private MediaSession mediaSession;
    private NotificationManager nm;
    private boolean foregroundStarted = false;

    private String curTitle = "NovaHub · 星隅";
    private String curArtist = "";
    private String curLyric = "";
    private String curCoverUrl = "";
    private boolean curPlaying = false;
    private long curPosMs = 0L;
    private long curDurationMs = 0L;
    private float curSpeed = 1.0f;
    private String curType = "audio";

    private volatile String cachedCoverUrl = "";
    private volatile Bitmap cachedCoverBmp = null;
    private volatile String loadingCoverUrl = "";
    private volatile Bitmap fallbackAppBmp = null;

    /** 兼容旧版 4 参数媒体通知入口 */
    public static void pushUpdate(Context ctx, String title, String artist, boolean playing, String type) {
        pushRichUpdate(ctx, title, artist, "", "", playing, 0L, 0L, 1.0f, type);
    }

    /** 供 Activity/桥接层统一更新状态栏媒体卡片（含实时歌词、封面、进度与总时长） */
    public static void pushRichUpdate(Context ctx, String title, String artist, String lyric,
                                      String coverUrl, boolean playing, long posMs,
                                      long durationMs, float speed, String type) {
        final String safeTitle = (title != null && !title.isEmpty()) ? title : "NovaHub · 星隅";
        final String safeArtist = artist != null ? artist : "";
        final String safeLyric = lyric != null ? lyric.trim() : "";
        final String safeCover = coverUrl != null ? coverUrl.trim() : "";
        final long safeDur = Math.max(0L, durationMs);
        final long safePos = safeDur > 0 ? Math.max(0L, Math.min(safeDur, posMs)) : Math.max(0L, posMs);
        final float safeSpeed = (speed > 0f && speed <= 4f) ? speed : 1.0f;
        final String safeType = (type != null && !type.isEmpty()) ? type : "audio";

        MediaNotifyService svc = activeInstance != null ? activeInstance.get() : null;
        if (svc != null && svc.foregroundStarted) {
            mainHandler.post(() -> {
                MediaNotifyService alive = activeInstance != null ? activeInstance.get() : null;
                if (alive != null) {
                    alive.applyRichState(safeTitle, safeArtist, safeLyric, safeCover,
                            playing, safePos, safeDur, safeSpeed, safeType);
                }
            });
            return;
        }

        try {
            Intent it = new Intent(ctx, MediaNotifyService.class);
            it.setAction(ACTION_UPDATE);
            it.putExtra("title", safeTitle);
            it.putExtra("artist", safeArtist);
            it.putExtra("lyric", safeLyric);
            it.putExtra("coverUrl", safeCover);
            it.putExtra("playing", playing);
            it.putExtra("posMs", safePos);
            it.putExtra("durationMs", safeDur);
            it.putExtra("speed", safeSpeed);
            it.putExtra("type", safeType);
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(it);
            else ctx.startService(it);
        } catch (Throwable ignored) {}
    }

    /** 清理前台媒体通知 */
    public static void clear(Context ctx) {
        try {
            ctx.stopService(new Intent(ctx, MediaNotifyService.class));
        } catch (Throwable ignored) {}
    }

    @Override
    public void onCreate() {
        super.onCreate();
        activeInstance = new WeakReference<>(this);
        nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm != null) {
            NotificationChannel ch = new NotificationChannel(CH_ID, "媒体播放控制", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("在状态栏和锁屏界面控制音乐与视频播放并显示歌词进度");
            ch.setShowBadge(false);
            ch.setSound(null, null);
            nm.createNotificationChannel(ch);
        }
        mediaSession = new MediaSession(this, "NovaHubMedia");
        mediaSession.setCallback(new MediaSession.Callback() {
            @Override
            public void onPlay() { MainActivity.dispatchMediaAction("play_pause"); }
            @Override
            public void onPause() { MainActivity.dispatchMediaAction("play_pause"); }
            @Override
            public void onSkipToPrevious() { MainActivity.dispatchMediaAction("prev"); }
            @Override
            public void onSkipToNext() { MainActivity.dispatchMediaAction("next"); }
            @Override
            public void onSeekTo(long pos) {
                long clamped = curDurationMs > 0 ? Math.max(0L, Math.min(curDurationMs, pos)) : Math.max(0L, pos);
                curPosMs = clamped;
                refreshPlaybackStateOnly();
                MainActivity.dispatchMediaSeek(clamped);
            }
            @Override
            public void onStop() {
                MainActivity.dispatchMediaAction("close");
                stopSelfClean();
            }
        });
        mediaSession.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            String act = intent.getAction();
            if (ACTION_CMD.equals(act)) {
                String cmd = intent.getStringExtra("cmd");
                if ("close".equals(cmd)) {
                    MainActivity.dispatchMediaAction("close");
                    stopSelfClean();
                    return START_NOT_STICKY;
                }
                if (cmd != null) MainActivity.dispatchMediaAction(cmd);
                return START_NOT_STICKY;
            }
            if (ACTION_UPDATE.equals(act)) {
                String t = intent.getStringExtra("title");
                String a = intent.getStringExtra("artist");
                String l = intent.getStringExtra("lyric");
                String c = intent.getStringExtra("coverUrl");
                boolean p = intent.getBooleanExtra("playing", false);
                long pos = intent.getLongExtra("posMs", 0L);
                long dur = intent.getLongExtra("durationMs", 0L);
                float spd = intent.getFloatExtra("speed", 1.0f);
                String tp = intent.getStringExtra("type");
                applyRichState(
                        (t != null && !t.isEmpty()) ? t : curTitle,
                        a != null ? a : "",
                        l != null ? l : "",
                        c != null ? c : "",
                        p, pos, dur, spd,
                        (tp != null && !tp.isEmpty()) ? tp : curType
                );
                return START_NOT_STICKY;
            }
        }
        updateNotification();
        return START_NOT_STICKY;
    }

    /** 应用来自网页端的新媒体状态并触发封面异步预加载 */
    private void applyRichState(String title, String artist, String lyric, String coverUrl,
                                boolean playing, long posMs, long durationMs, float speed, String type) {
        curTitle = title;
        curArtist = artist;
        curLyric = lyric;
        curCoverUrl = coverUrl;
        curPlaying = playing;
        curPosMs = posMs;
        curDurationMs = durationMs;
        curSpeed = speed;
        curType = type;
        if (coverUrl.startsWith("http://") || coverUrl.startsWith("https://")) {
            ensureCoverLoaded(coverUrl);
        }
        updateNotification();
    }

    /** 在系统通知栏拖动 SeekBar 后立即同步 PlaybackState，避免滑块回弹 */
    private void refreshPlaybackStateOnly() {
        try {
            if (mediaSession == null) return;
            mediaSession.setPlaybackState(buildPlaybackState());
        } catch (Throwable ignored) {}
    }

    private PlaybackState buildPlaybackState() {
        long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE
                | PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_STOP;
        if (curDurationMs > 0) {
            actions |= PlaybackState.ACTION_SEEK_TO;
        }
        long safePos = curDurationMs > 0 ? Math.max(0L, Math.min(curDurationMs, curPosMs)) : Math.max(0L, curPosMs);
        float playbackSpeed = curPlaying ? curSpeed : 0f;
        return new PlaybackState.Builder()
                .setActions(actions)
                .setState(curPlaying ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                        safePos, playbackSpeed, SystemClock.elapsedRealtime())
                .build();
    }

    private void updateNotification() {
        try {
            if (mediaSession == null) return;
            mediaSession.setPlaybackState(buildPlaybackState());

            String defaultSub = "video".equals(curType) ? "NovaHub 影院" : "NovaHub 音乐";
            String artistOrSub = curArtist.isEmpty() ? defaultSub : curArtist;
            // 有实时歌词时将歌词放到主副标题，歌手名退到专辑/SubText 位置，兼顾通知栏与锁屏可读性
            String displaySubtitle = !curLyric.isEmpty() ? curLyric : artistOrSub;
            String displayAlbum = (!curLyric.isEmpty() && !curArtist.isEmpty()) ? curArtist : "NovaHub · 星隅";

            Bitmap artBmp = resolveCurrentArtwork();
            MediaMetadata.Builder mm = new MediaMetadata.Builder()
                    .putString(MediaMetadata.METADATA_KEY_TITLE, curTitle)
                    .putString(MediaMetadata.METADATA_KEY_ARTIST, displaySubtitle)
                    .putString(MediaMetadata.METADATA_KEY_ALBUM, displayAlbum);
            if (curDurationMs > 0) {
                mm.putLong(MediaMetadata.METADATA_KEY_DURATION, curDurationMs);
            }
            if (artBmp != null) {
                mm.putBitmap(MediaMetadata.METADATA_KEY_ART, artBmp);
                mm.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, artBmp);
            }
            mediaSession.setMetadata(mm.build());

            Intent openIntent = new Intent(this, MainActivity.class);
            openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            int pFlags = Build.VERSION.SDK_INT >= 23
                    ? (PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE)
                    : PendingIntent.FLAG_UPDATE_CURRENT;
            PendingIntent openPi = PendingIntent.getActivity(this, 10, openIntent, pFlags);

            Notification.Builder nb = Build.VERSION.SDK_INT >= 26
                    ? new Notification.Builder(this, CH_ID)
                    : new Notification.Builder(this);

            nb.setSmallIcon(R.mipmap.ic_launcher)
                    .setContentTitle(curTitle)
                    .setContentText(displaySubtitle)
                    .setContentIntent(openPi)
                    .setOngoing(curPlaying)
                    .setOnlyAlertOnce(true)
                    .setShowWhen(false)
                    .setVisibility(Notification.VISIBILITY_PUBLIC);
            if (!curLyric.isEmpty() && !curArtist.isEmpty()) {
                nb.setSubText(curArtist);
            }
            if (artBmp != null) nb.setLargeIcon(artBmp);

            nb.addAction(buildAction(android.R.drawable.ic_media_previous, "上一曲", "prev", 1));
            nb.addAction(buildAction(
                    curPlaying ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                    curPlaying ? "暂停" : "播放",
                    "play_pause",
                    2
            ));
            nb.addAction(buildAction(android.R.drawable.ic_media_next, "下一曲", "next", 3));
            nb.addAction(buildAction(android.R.drawable.ic_menu_close_clear_cancel, "关闭", "close", 4));

            nb.setStyle(new Notification.MediaStyle()
                    .setMediaSession(mediaSession.getSessionToken())
                    .setShowActionsInCompactView(0, 1, 2));

            Notification notif = nb.build();
            if (!foregroundStarted) {
                if (Build.VERSION.SDK_INT >= 29) {
                    startForeground(NOTIFY_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
                } else {
                    startForeground(NOTIFY_ID, notif);
                }
                foregroundStarted = true;
            } else if (nm != null) {
                nm.notify(NOTIFY_ID, notif);
            }
        } catch (Throwable ignored) {}
    }

    /** 异步拉取并采样缩放当前歌曲封面，避免主线程阻塞或大图 OOM */
    private void ensureCoverLoaded(final String url) {
        if (url.equals(cachedCoverUrl) || url.equals(loadingCoverUrl)) return;
        loadingCoverUrl = url;
        coverExecutor.execute(() -> {
            Bitmap bmp = downloadSampledBitmap(url, 256);
            if (bmp != null) {
                cachedCoverUrl = url;
                cachedCoverBmp = bmp;
                mainHandler.post(() -> {
                    if (url.equals(curCoverUrl) && foregroundStarted) {
                        updateNotification();
                    }
                });
            }
            if (url.equals(loadingCoverUrl)) loadingCoverUrl = "";
        });
    }

    private Bitmap resolveCurrentArtwork() {
        if (!curCoverUrl.isEmpty() && curCoverUrl.equals(cachedCoverUrl) && cachedCoverBmp != null) {
            return cachedCoverBmp;
        }
        return loadAppIconBitmap();
    }

    private Bitmap downloadSampledBitmap(String urlStr, int maxDim) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(urlStr).openConnection();
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(5000);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestProperty("User-Agent", "NovaHub-Android-Media");
            if (conn.getResponseCode() != 200) return null;
            byte[] raw;
            try (InputStream in = conn.getInputStream(); ByteArrayOutputStream bos = new ByteArrayOutputStream()) {
                byte[] buf = new byte[4096];
                int n;
                int total = 0;
                while ((n = in.read(buf)) > 0) {
                    total += n;
                    if (total > 2 * 1024 * 1024) return null;
                    bos.write(buf, 0, n);
                }
                raw = bos.toByteArray();
            }
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(raw, 0, raw.length, bounds);
            int sample = 1;
            int w = bounds.outWidth, h = bounds.outHeight;
            while (w / sample > maxDim * 2 || h / sample > maxDim * 2) {
                sample *= 2;
            }
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inSampleSize = sample;
            Bitmap decoded = BitmapFactory.decodeByteArray(raw, 0, raw.length, opts);
            if (decoded == null) return null;
            if (decoded.getWidth() > maxDim || decoded.getHeight() > maxDim) {
                float scale = Math.min((float) maxDim / decoded.getWidth(), (float) maxDim / decoded.getHeight());
                Bitmap scaled = Bitmap.createScaledBitmap(decoded,
                        Math.max(1, Math.round(decoded.getWidth() * scale)),
                        Math.max(1, Math.round(decoded.getHeight() * scale)), true);
                if (scaled != decoded) decoded.recycle();
                return scaled;
            }
            return decoded;
        } catch (Throwable e) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private Notification.Action buildAction(int iconRes, String title, String cmd, int reqCode) {
        Intent it = new Intent(this, MediaNotifyService.class);
        it.setAction(ACTION_CMD);
        it.putExtra("cmd", cmd);
        int flags = Build.VERSION.SDK_INT >= 23
                ? (PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE)
                : PendingIntent.FLAG_UPDATE_CURRENT;
        PendingIntent pi = PendingIntent.getService(this, reqCode, it, flags);
        return new Notification.Action.Builder(Icon.createWithResource(this, iconRes), title, pi).build();
    }

    private Bitmap loadAppIconBitmap() {
        if (fallbackAppBmp != null) return fallbackAppBmp;
        try {
            Drawable d = getApplicationInfo().loadIcon(getPackageManager());
            int w = Math.max(96, Math.min(192, d.getIntrinsicWidth() > 0 ? d.getIntrinsicWidth() : 128));
            int h = Math.max(96, Math.min(192, d.getIntrinsicHeight() > 0 ? d.getIntrinsicHeight() : 128));
            Bitmap b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
            Canvas c = new Canvas(b);
            d.setBounds(0, 0, w, h);
            d.draw(c);
            fallbackAppBmp = b;
            return b;
        } catch (Throwable e) {
            return null;
        }
    }

    private void stopSelfClean() {
        foregroundStarted = false;
        try {
            if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE);
            else stopForeground(true);
        } catch (Throwable ignored) {}
        stopSelf();
    }

    @Override
    public void onDestroy() {
        foregroundStarted = false;
        if (activeInstance != null && activeInstance.get() == this) {
            activeInstance = null;
        }
        if (mediaSession != null) {
            try {
                mediaSession.setActive(false);
                mediaSession.release();
            } catch (Throwable ignored) {}
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
