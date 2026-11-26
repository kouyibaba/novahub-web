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
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.Icon;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.IBinder;

/**
 * 原生前台媒体通知与锁屏 MediaSession 控制服务（零第三方依赖）
 */
public class MediaNotifyService extends Service {
    public static final String ACTION_UPDATE = "com.novahub.app.MEDIA_UPDATE";
    public static final String ACTION_CMD = "com.novahub.app.MEDIA_CMD";
    private static final String CH_ID = "novahub_media";
    private static final int NOTIFY_ID = 1001;

    private MediaSession mediaSession;
    private NotificationManager nm;
    private String curTitle = "NovaHub · 星隅";
    private String curArtist = "";
    private boolean curPlaying = false;
    private String curType = "audio";

    /** 供 Activity/桥接层统一更新状态栏媒体卡片 */
    public static void pushUpdate(Context ctx, String title, String artist, boolean playing, String type) {
        try {
            Intent it = new Intent(ctx, MediaNotifyService.class);
            it.setAction(ACTION_UPDATE);
            it.putExtra("title", title);
            it.putExtra("artist", artist);
            it.putExtra("playing", playing);
            it.putExtra("type", type);
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
        nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm != null) {
            NotificationChannel ch = new NotificationChannel(CH_ID, "媒体播放控制", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("在状态栏和锁屏界面控制音乐与视频播放");
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
                if (t != null && !t.isEmpty()) curTitle = t;
                curArtist = a != null ? a : "";
                curPlaying = intent.getBooleanExtra("playing", false);
                String tp = intent.getStringExtra("type");
                if (tp != null) curType = tp;
            }
        }
        updateNotification();
        return START_NOT_STICKY;
    }

    private void updateNotification() {
        try {
            long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE
                    | PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_STOP;
            PlaybackState ps = new PlaybackState.Builder()
                    .setActions(actions)
                    .setState(curPlaying ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, 0L, 1.0f)
                    .build();
            mediaSession.setPlaybackState(ps);

            MediaMetadata.Builder mm = new MediaMetadata.Builder()
                    .putString(MediaMetadata.METADATA_KEY_TITLE, curTitle)
                    .putString(MediaMetadata.METADATA_KEY_ARTIST, curArtist.isEmpty() ? ("video".equals(curType) ? "NovaHub 影院" : "NovaHub 音乐") : curArtist)
                    .putString(MediaMetadata.METADATA_KEY_ALBUM, "NovaHub · 星隅");
            Bitmap appBmp = loadAppIconBitmap();
            if (appBmp != null) mm.putBitmap(MediaMetadata.METADATA_KEY_ART, appBmp);
            mediaSession.setMetadata(mm.build());

            Intent openIntent = new Intent(this, MainActivity.class);
            openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            int pFlags = Build.VERSION.SDK_INT >= 23 ? (PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE) : PendingIntent.FLAG_UPDATE_CURRENT;
            PendingIntent openPi = PendingIntent.getActivity(this, 10, openIntent, pFlags);

            Notification.Builder nb = Build.VERSION.SDK_INT >= 26
                    ? new Notification.Builder(this, CH_ID)
                    : new Notification.Builder(this);

            nb.setSmallIcon(R.mipmap.ic_launcher)
                    .setContentTitle(curTitle)
                    .setContentText(curArtist.isEmpty() ? "NovaHub · 私人视听空间" : curArtist)
                    .setContentIntent(openPi)
                    .setOngoing(curPlaying)
                    .setOnlyAlertOnce(true)
                    .setVisibility(Notification.VISIBILITY_PUBLIC);
            if (appBmp != null) nb.setLargeIcon(appBmp);

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
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(NOTIFY_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(NOTIFY_ID, notif);
            }
        } catch (Throwable ignored) {}
    }

    private Notification.Action buildAction(int iconRes, String title, String cmd, int reqCode) {
        Intent it = new Intent(this, MediaNotifyService.class);
        it.setAction(ACTION_CMD);
        it.putExtra("cmd", cmd);
        int flags = Build.VERSION.SDK_INT >= 23 ? (PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE) : PendingIntent.FLAG_UPDATE_CURRENT;
        PendingIntent pi = PendingIntent.getService(this, reqCode, it, flags);
        return new Notification.Action.Builder(Icon.createWithResource(this, iconRes), title, pi).build();
    }

    private Bitmap loadAppIconBitmap() {
        try {
            Drawable d = getApplicationInfo().loadIcon(getPackageManager());
            int w = Math.max(96, Math.min(192, d.getIntrinsicWidth() > 0 ? d.getIntrinsicWidth() : 128));
            int h = Math.max(96, Math.min(192, d.getIntrinsicHeight() > 0 ? d.getIntrinsicHeight() : 128));
            Bitmap b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
            Canvas c = new Canvas(b);
            d.setBounds(0, 0, w, h);
            d.draw(c);
            return b;
        } catch (Throwable e) {
            return null;
        }
    }

    private void stopSelfClean() {
        try {
            if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE);
            else stopForeground(true);
        } catch (Throwable ignored) {}
        stopSelf();
    }

    @Override
    public void onDestroy() {
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
