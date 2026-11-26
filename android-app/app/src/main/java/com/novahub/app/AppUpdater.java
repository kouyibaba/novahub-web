package com.novahub.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.json.JSONObject;

/**
 * 零第三方依赖应用内自动更新器（版本比对 + 未知来源权限引导 + 双源容灾下载 + SHA-256 校验）
 */
public class AppUpdater {
    private static final String VERSION_URL = "https://kouyibaba.github.io/novahub-web/apk-version.json";
    private static final String PREF_NAME = "novahub_updater";
    private static volatile boolean checking = false;

    /** 获取当前客户端整数版本号 */
    public static int getCurrentVersionCode(Activity act) {
        try {
            PackageInfo pi = act.getPackageManager().getPackageInfo(act.getPackageName(), 0);
            if (Build.VERSION.SDK_INT >= 28) return (int) pi.getLongVersionCode();
            return pi.versionCode;
        } catch (Exception e) {
            return 0;
        }
    }

    /** 获取当前客户端版本名 */
    public static String getCurrentVersionName(Activity act) {
        try {
            return act.getPackageManager().getPackageInfo(act.getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "2.4.0";
        }
    }

    /** 启动清理残留安装包 */
    public static void cleanupOldApks(Activity act) {
        try {
            File dir = new File(act.getExternalFilesDir(null), "update");
            if (dir.isDirectory()) {
                File[] files = dir.listFiles();
                if (files != null) {
                    for (File f : files) {
                        if (f.getName().endsWith(".apk")) f.delete();
                    }
                }
            }
        } catch (Throwable ignored) {}
    }

    /** 检查版本更新（manual=false 时遵循 12 小时跳过冷却，force=true 必弹窗） */
    public static void check(Activity act, boolean manual) {
        if (checking || act.isFinishing()) return;
        checking = true;
        Handler ui = new Handler(Looper.getMainLooper());
        new Thread(() -> {
            try {
                HttpURLConnection conn = openWithRedirects(VERSION_URL + "?t=" + System.currentTimeMillis(), 8000);
                if (conn.getResponseCode() != 200) {
                    if (manual) ui.post(() -> toast(act, "版本信息检查失败，请稍后重试"));
                    return;
                }
                StringBuilder sb = new StringBuilder();
                try (BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = br.readLine()) != null) sb.append(line);
                }
                JSONObject obj = new JSONObject(sb.toString());
                int remoteCode = obj.optInt("versionCode", 0);
                String remoteName = obj.optString("versionName", "");
                String notes = obj.optString("notes", "性能优化与体验升级");
                boolean force = obj.optBoolean("force", false);
                String sha256 = obj.optString("sha256", "");
                String url = obj.optString("url", "");
                String fallbackUrl = obj.optString("fallback_url", "");

                int localCode = getCurrentVersionCode(act);
                if (remoteCode <= localCode || url.isEmpty()) {
                    if (manual) ui.post(() -> toast(act, "当前已是最新版 (v" + getCurrentVersionName(act) + ")"));
                    return;
                }
                if (!manual && !force) {
                    SharedPreferences sp = act.getSharedPreferences(PREF_NAME, Activity.MODE_PRIVATE);
                    int skippedVer = sp.getInt("skip_ver", 0);
                    long skippedAt = sp.getLong("skip_at", 0);
                    if (skippedVer == remoteCode && System.currentTimeMillis() - skippedAt < 12 * 3600_000L) {
                        return;
                    }
                }
                ui.post(() -> showUpdateDialog(act, remoteCode, remoteName, notes, force, sha256, url, fallbackUrl));
            } catch (Exception e) {
                if (manual) ui.post(() -> toast(act, "检查更新超时，请检查网络"));
            } finally {
                checking = false;
            }
        }).start();
    }

    private static void showUpdateDialog(Activity act, int remoteCode, String remoteName, String notes,
                                         boolean force, String sha256, String url, String fallbackUrl) {
        if (act.isFinishing()) return;
        AlertDialog.Builder b = new AlertDialog.Builder(act)
                .setTitle("发现新版本 v" + remoteName)
                .setMessage(notes)
                .setCancelable(!force)
                .setPositiveButton("立即更新", (d, w) -> ensureInstallPermAndDownload(act, remoteCode, sha256, url, fallbackUrl));
        if (!force) {
            b.setNegativeButton("稍后再说", (d, w) -> act.getSharedPreferences(PREF_NAME, Activity.MODE_PRIVATE)
                    .edit().putInt("skip_ver", remoteCode).putLong("skip_at", System.currentTimeMillis()).apply());
        }
        b.show();
    }

    private static void ensureInstallPermAndDownload(Activity act, int remoteCode, String sha256, String url, String fallbackUrl) {
        if (Build.VERSION.SDK_INT >= 26 && !act.getPackageManager().canRequestPackageInstalls()) {
            new AlertDialog.Builder(act)
                    .setTitle("需要开启安装权限")
                    .setMessage("请在跳转页面中开启「允许来自此来源的应用」，开启后返回即可继续升级。")
                    .setPositiveButton("去开启", (d, w) -> {
                        try {
                            Intent it = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + act.getPackageName()));
                            act.startActivity(it);
                        } catch (Exception e) {
                            toast(act, "无法打开权限设置页");
                        }
                    })
                    .setNegativeButton("取消", null)
                    .show();
            return;
        }
        startDownload(act, remoteCode, sha256, url, fallbackUrl);
    }

    private static void startDownload(Activity act, int remoteCode, String expectedSha256, String primaryUrl, String fallbackUrl) {
        Handler ui = new Handler(Looper.getMainLooper());
        LinearLayout box = new LinearLayout(act);
        box.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (20 * act.getResources().getDisplayMetrics().density);
        box.setPadding(pad, pad / 2, pad, pad / 2);

        TextView label = new TextView(act);
        label.setText("正在连接下载节点…");
        label.setGravity(Gravity.CENTER_HORIZONTAL);
        ProgressBar bar = new ProgressBar(act, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);
        bar.setProgress(0);
        box.addView(label);
        box.addView(bar);

        AlertDialog dlg = new AlertDialog.Builder(act)
                .setTitle("正在下载更新包")
                .setView(box)
                .setCancelable(false)
                .create();
        dlg.show();

        new Thread(() -> {
            File updateDir = new File(act.getExternalFilesDir(null), "update");
            if (!updateDir.exists()) updateDir.mkdirs();
            File outFile = new File(updateDir, "novahub-" + remoteCode + ".apk");

            String[] urls = (fallbackUrl != null && !fallbackUrl.isEmpty())
                    ? new String[]{primaryUrl, fallbackUrl}
                    : new String[]{primaryUrl};

            boolean ok = false;
            String failMsg = "下载失败";
            for (String u : urls) {
                try {
                    HttpURLConnection conn = openWithRedirects(u, 15000);
                    if (conn.getResponseCode() != 200) {
                        failMsg = "HTTP " + conn.getResponseCode();
                        continue;
                    }
                    int total = conn.getContentLength();
                    MessageDigest md = MessageDigest.getInstance("SHA-256");
                    byte[] buf = new byte[8192];
                    long readSum = 0;
                    try (InputStream in = conn.getInputStream(); FileOutputStream fos = new FileOutputStream(outFile)) {
                        int n;
                        while ((n = in.read(buf)) > 0) {
                            fos.write(buf, 0, n);
                            md.update(buf, 0, n);
                            readSum += n;
                            if (total > 0) {
                                int pct = (int) ((readSum * 100L) / total);
                                ui.post(() -> {
                                    bar.setProgress(pct);
                                    label.setText("已下载 " + pct + "%");
                                });
                            }
                        }
                    }
                    if (expectedSha256 != null && !expectedSha256.isEmpty()) {
                        StringBuilder hex = new StringBuilder();
                        for (byte b : md.digest()) hex.append(String.format("%02x", b));
                        if (!expectedSha256.equalsIgnoreCase(hex.toString())) {
                            outFile.delete();
                            failMsg = "安装包校验不一致";
                            continue;
                        }
                    }
                    ok = true;
                    break;
                } catch (Exception e) {
                    failMsg = e.getMessage() != null ? e.getMessage() : "网络异常";
                    if (outFile.exists()) outFile.delete();
                }
            }

            final boolean success = ok;
            final String errText = failMsg;
            ui.post(() -> {
                if (dlg.isShowing()) dlg.dismiss();
                if (!success) {
                    toast(act, "更新下载失败：" + errText);
                    return;
                }
                try {
                    Uri apkUri = ApkFileProvider.getApkUri(act, outFile);
                    Intent inst = new Intent(Intent.ACTION_VIEW);
                    inst.setDataAndType(apkUri, "application/vnd.android.package-archive");
                    inst.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                    act.startActivity(inst);
                } catch (Exception e) {
                    toast(act, "拉起系统安装器失败：" + e.getMessage());
                }
            });
        }).start();
    }

    /** 手动处理 HTTP/HTTPS 跨协议重定向（GitHub Releases 常 302 跳转至 CDN） */
    private static HttpURLConnection openWithRedirects(String urlStr, int timeoutMs) throws Exception {
        String cur = urlStr;
        for (int i = 0; i < 6; i++) {
            HttpURLConnection conn = (HttpURLConnection) new URL(cur).openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(timeoutMs);
            conn.setReadTimeout(timeoutMs);
            conn.setRequestProperty("User-Agent", "NovaHub-Android-Updater");
            int code = conn.getResponseCode();
            if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                String loc = conn.getHeaderField("Location");
                conn.disconnect();
                if (loc == null || loc.isEmpty()) break;
                cur = new URL(new URL(cur), loc).toString();
                continue;
            }
            return conn;
        }
        throw new Exception("重定向次数过多");
    }

    private static void toast(Activity act, String msg) {
        Toast.makeText(act, msg, Toast.LENGTH_SHORT).show();
    }
}
