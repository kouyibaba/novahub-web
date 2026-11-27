package com.novahub.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 轻量级收藏更新轮询服务（基于系统 JobScheduler，零第三方推送 SDK，支持去重与多条合并提醒）
 */
public class UpdatePollService extends JobService {
    private static final int JOB_ID = 2047;
    private static final int NOTIFY_ID = 2048;
    private static final String CH_ID = "novahub_updates";
    private static final String PREF_NAME = "novahub_notif_poll";
    private static final String ENDPOINT_JSON = "https://kouyibaba.github.io/novahub-web/endpoint.json";

    public static void schedule(Context ctx) {
        if (ctx == null) return;
        try {
            JobScheduler js = (JobScheduler) ctx.getSystemService(Context.JOB_SCHEDULER_SERVICE);
            if (js == null) return;
            for (JobInfo j : js.getAllPendingJobs()) {
                if (j.getId() == JOB_ID) return;
            }
            JobInfo info = new JobInfo.Builder(JOB_ID, new ComponentName(ctx, UpdatePollService.class))
                    .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                    .setPeriodic(2 * 3600_000L)
                    .setPersisted(false)
                    .build();
            js.schedule(info);
        } catch (Throwable ignored) {}
    }

    @Override
    public boolean onStartJob(JobParameters params) {
        new Thread(() -> {
            try {
                pollAndNotify();
            } finally {
                jobFinished(params, false);
            }
        }).start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        return true;
    }

    private void pollAndNotify() {
        try {
            if (Build.VERSION.SDK_INT >= 33 &&
                    checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
                return;
            }
            JSONObject session = new SessionStore(this).read();
            String token = session.optString("token", "");
            if (token.isEmpty()) return;

            String epRaw = httpGet(ENDPOINT_JSON + "?t=" + System.currentTimeMillis(), null, 6000);
            if (epRaw == null) return;
            String base = new JSONObject(epRaw).optString("url", "").replaceAll("/+$", "");
            if (base.isEmpty()) return;

            String resRaw = httpGet(base + "/api/notifications?unread=1&limit=10", token, 8000);
            if (resRaw == null) return;
            JSONObject obj = new JSONObject(resRaw);
            JSONArray items = obj.optJSONArray("items");
            if (items == null || items.length() == 0) return;

            SharedPreferences sp = getSharedPreferences(PREF_NAME, MODE_PRIVATE);
            long lastId = sp.getLong("last_notified_id", 0L);
            long maxId = lastId;
            int freshCount = 0;
            JSONObject latestFresh = null;
            for (int i = 0; i < items.length(); i++) {
                JSONObject it = items.optJSONObject(i);
                if (it == null) continue;
                long id = it.optLong("id", 0L);
                if (id > lastId) {
                    freshCount++;
                    if (latestFresh == null) latestFresh = it;
                    if (id > maxId) maxId = id;
                }
            }
            if (freshCount <= 0 || latestFresh == null) return;

            String title = freshCount == 1
                    ? ("《" + latestFresh.optString("title", "收藏更新") + "》有新更新")
                    : ("收藏与书架有 " + freshCount + " 项新更新");
            String msg = freshCount == 1
                    ? latestFresh.optString("message", "点击查看最新剧集或章节")
                    : ("最新：《" + latestFresh.optString("title", "") + "》" + latestFresh.optString("message", ""));

            showSystemNotification(title, msg);
            sp.edit().putLong("last_notified_id", maxId).apply();
        } catch (Throwable ignored) {}
    }

    private void showSystemNotification(String title, String content) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CH_ID, "收藏更新提醒", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("电视剧集数与书架小说章节更新提醒");
            nm.createNotificationChannel(ch);
        }
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.putExtra("open_notifications", true);
        openIntent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent pi = PendingIntent.getActivity(this, 2049, openIntent, flags);

        Notification.Builder nb = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CH_ID)
                : new Notification.Builder(this);
        nb.setSmallIcon(android.R.drawable.stat_notify_more)
                .setContentTitle(title)
                .setContentText(content)
                .setAutoCancel(true)
                .setContentIntent(pi);
        nm.notify(NOTIFY_ID, nb.build());
    }

    private String httpGet(String urlStr, String bearer, int timeoutMs) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(urlStr).openConnection();
            conn.setConnectTimeout(timeoutMs);
            conn.setReadTimeout(timeoutMs);
            conn.setRequestProperty("User-Agent", "NovaHub-Android-Poll");
            if (bearer != null && !bearer.isEmpty()) {
                conn.setRequestProperty("Authorization", "Bearer " + bearer);
            }
            if (conn.getResponseCode() != 200) return null;
            StringBuilder sb = new StringBuilder();
            try (BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = br.readLine()) != null) sb.append(line);
            }
            return sb.toString();
        } catch (Exception ignored) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
