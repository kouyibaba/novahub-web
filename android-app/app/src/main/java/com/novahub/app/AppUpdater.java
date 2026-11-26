package com.novahub.app;

import android.app.Activity;
import android.app.Dialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.ClipDrawable;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.LayerDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.ScrollView;
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
 * 零第三方依赖应用内自动更新器（深曜石黑暖琥珀金卡片 UI + 双源容灾下载 + SHA-256 校验）
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
            return "2.4.2";
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

    /** 检查版本更新（manual=false 时遵循 12 小时跳过冷却，manual=true 必弹窗） */
    public static void check(Activity act, boolean manual) {
        if (checking || isActivityDead(act)) return;
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
        if (isActivityDead(act)) return;

        Dialog dlg = createStyledDialog(act, !force);
        LinearLayout card = buildCardRoot(act);

        // 顶部：NEW 版本琥珀徽章 + 当前版本对比
        LinearLayout badgeRow = new LinearLayout(act);
        badgeRow.setOrientation(LinearLayout.HORIZONTAL);
        badgeRow.setGravity(Gravity.CENTER_VERTICAL);

        TextView badge = new TextView(act);
        badge.setText("NEW · v" + remoteName);
        badge.setTextColor(Color.parseColor("#E8C478"));
        badge.setTextSize(11.5f);
        badge.setTypeface(Typeface.DEFAULT_BOLD);
        badge.setPadding(dp(act, 10), dp(act, 4), dp(act, 10), dp(act, 4));
        badge.setBackground(makePill(act, Color.parseColor("#24E2B466"), Color.parseColor("#55E2B466"), 99));

        TextView curVer = new TextView(act);
        curVer.setText("当前 v" + getCurrentVersionName(act));
        curVer.setTextColor(Color.parseColor("#7E8596"));
        curVer.setTextSize(11.5f);
        curVer.setGravity(Gravity.END);
        LinearLayout.LayoutParams curLp = new LinearLayout.LayoutParams(0, -2, 1f);
        badgeRow.addView(badge);
        badgeRow.addView(curVer, curLp);
        card.addView(badgeRow);

        // 主标题
        TextView titleView = new TextView(act);
        titleView.setText("发现新版本");
        titleView.setTextColor(Color.parseColor("#F7F1E3"));
        titleView.setTextSize(19f);
        titleView.setTypeface(Typeface.DEFAULT_BOLD);
        LinearLayout.LayoutParams tLp = new LinearLayout.LayoutParams(-1, -2);
        tLp.topMargin = dp(act, 12);
        tLp.bottomMargin = dp(act, 12);
        card.addView(titleView, tLp);

        // 更新日志内嵌暗岩卡片（限制最大高度可滚动）
        LinearLayout notesBox = new LinearLayout(act);
        notesBox.setOrientation(LinearLayout.VERTICAL);
        notesBox.setBackground(makePill(act, Color.parseColor("#0D0F14"), Color.parseColor("#14FFFFFF"), 12));
        notesBox.setPadding(dp(act, 14), dp(act, 12), dp(act, 14), dp(act, 12));

        ScrollView scroll = new ScrollView(act);
        scroll.setVerticalScrollBarEnabled(false);
        TextView notesView = new TextView(act);
        notesView.setText(formatBulletNotes(notes));
        notesView.setTextColor(Color.parseColor("#C8CDD8"));
        notesView.setTextSize(13.5f);
        notesView.setLineSpacing(dp(act, 3), 1.35f);
        scroll.addView(notesView);

        LinearLayout.LayoutParams scLp = new LinearLayout.LayoutParams(-1, -2);
        notesBox.addView(scroll, scLp);

        LinearLayout.LayoutParams nbLp = new LinearLayout.LayoutParams(-1, -2);
        card.addView(notesBox, nbLp);
        scroll.post(() -> {
            int maxH = dp(act, 160);
            if (scroll.getHeight() > maxH) {
                LinearLayout.LayoutParams p = (LinearLayout.LayoutParams) scroll.getLayoutParams();
                p.height = maxH;
                scroll.setLayoutParams(p);
            }
        });

        // 底部双按钮栏
        LinearLayout btnRow = new LinearLayout(act);
        btnRow.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams brLp = new LinearLayout.LayoutParams(-1, -2);
        brLp.topMargin = dp(act, 18);

        if (!force) {
            TextView laterBtn = makeActionButton(act, "稍后再说", false);
            laterBtn.setOnClickListener(v -> {
                act.getSharedPreferences(PREF_NAME, Activity.MODE_PRIVATE)
                        .edit().putInt("skip_ver", remoteCode).putLong("skip_at", System.currentTimeMillis()).apply();
                dlg.dismiss();
            });
            LinearLayout.LayoutParams lLp = new LinearLayout.LayoutParams(0, dp(act, 44), 1f);
            lLp.rightMargin = dp(act, 10);
            btnRow.addView(laterBtn, lLp);
        }

        TextView updateBtn = makeActionButton(act, "立即更新", true);
        updateBtn.setOnClickListener(v -> {
            dlg.dismiss();
            ensureInstallPermAndDownload(act, remoteCode, sha256, url, fallbackUrl);
        });
        LinearLayout.LayoutParams uLp = new LinearLayout.LayoutParams(0, dp(act, 44), force ? 1f : 1.35f);
        btnRow.addView(updateBtn, uLp);

        card.addView(btnRow, brLp);
        attachCardAndShow(act, dlg, card);
    }

    private static void ensureInstallPermAndDownload(Activity act, int remoteCode, String sha256, String url, String fallbackUrl) {
        if (isActivityDead(act)) return;
        if (Build.VERSION.SDK_INT >= 26 && !act.getPackageManager().canRequestPackageInstalls()) {
            Dialog dlg = createStyledDialog(act, true);
            LinearLayout card = buildCardRoot(act);

            TextView title = new TextView(act);
            title.setText("需要开启安装权限");
            title.setTextColor(Color.parseColor("#F7F1E3"));
            title.setTextSize(17.5f);
            title.setTypeface(Typeface.DEFAULT_BOLD);
            card.addView(title);

            TextView msg = new TextView(act);
            msg.setText("请在系统设置中开启「允许来自此来源的应用」，开启后返回即可一键更新安装包。");
            msg.setTextColor(Color.parseColor("#B4BAC7"));
            msg.setTextSize(13.5f);
            msg.setLineSpacing(dp(act, 2), 1.35f);
            LinearLayout.LayoutParams mLp = new LinearLayout.LayoutParams(-1, -2);
            mLp.topMargin = dp(act, 10);
            card.addView(msg, mLp);

            LinearLayout btnRow = new LinearLayout(act);
            btnRow.setOrientation(LinearLayout.HORIZONTAL);
            LinearLayout.LayoutParams brLp = new LinearLayout.LayoutParams(-1, -2);
            brLp.topMargin = dp(act, 18);

            TextView cancelBtn = makeActionButton(act, "取消", false);
            cancelBtn.setOnClickListener(v -> dlg.dismiss());
            LinearLayout.LayoutParams cLp = new LinearLayout.LayoutParams(0, dp(act, 42), 1f);
            cLp.rightMargin = dp(act, 10);

            TextView goBtn = makeActionButton(act, "去开启", true);
            goBtn.setOnClickListener(v -> {
                dlg.dismiss();
                try {
                    Intent it = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + act.getPackageName()));
                    act.startActivity(it);
                } catch (Exception e) {
                    toast(act, "无法打开权限设置页");
                }
            });
            LinearLayout.LayoutParams gLp = new LinearLayout.LayoutParams(0, dp(act, 42), 1.2f);

            btnRow.addView(cancelBtn, cLp);
            btnRow.addView(goBtn, gLp);
            card.addView(btnRow, brLp);
            attachCardAndShow(act, dlg, card);
            return;
        }
        startDownload(act, remoteCode, sha256, url, fallbackUrl);
    }

    private static void startDownload(Activity act, int remoteCode, String expectedSha256, String primaryUrl, String fallbackUrl) {
        if (isActivityDead(act)) return;
        Handler ui = new Handler(Looper.getMainLooper());

        Dialog dlg = createStyledDialog(act, false);
        LinearLayout card = buildCardRoot(act);

        // 顶部：标题 + 大号百分比数字
        LinearLayout headRow = new LinearLayout(act);
        headRow.setOrientation(LinearLayout.HORIZONTAL);
        headRow.setGravity(Gravity.CENTER_VERTICAL);

        TextView title = new TextView(act);
        title.setText("正在下载更新包");
        title.setTextColor(Color.parseColor("#F7F1E3"));
        title.setTextSize(17f);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        LinearLayout.LayoutParams tlLp = new LinearLayout.LayoutParams(0, -2, 1f);

        TextView pctView = new TextView(act);
        pctView.setText("0%");
        pctView.setTextColor(Color.parseColor("#E8C478"));
        pctView.setTextSize(20f);
        pctView.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);

        headRow.addView(title, tlLp);
        headRow.addView(pctView);
        card.addView(headRow);

        // 自定义暖金渐变圆角进度条（LayerDrawable + ClipDrawable）
        GradientDrawable track = new GradientDrawable();
        track.setColor(Color.parseColor("#232735"));
        track.setCornerRadius(dp(act, 99));

        GradientDrawable fillGrad = new GradientDrawable(
                GradientDrawable.Orientation.LEFT_RIGHT,
                new int[]{Color.parseColor("#E8C478"), Color.parseColor("#D49E44")}
        );
        fillGrad.setCornerRadius(dp(act, 99));
        ClipDrawable progressClip = new ClipDrawable(fillGrad, Gravity.START, ClipDrawable.HORIZONTAL);
        progressClip.setLevel(0);

        LayerDrawable barDrawable = new LayerDrawable(new Drawable[]{track, progressClip});
        View progressBarView = new View(act);
        progressBarView.setBackground(barDrawable);
        LinearLayout.LayoutParams pbLp = new LinearLayout.LayoutParams(-1, dp(act, 8));
        pbLp.topMargin = dp(act, 16);
        pbLp.bottomMargin = dp(act, 12);
        card.addView(progressBarView, pbLp);

        // 状态与字节计数文本
        TextView label = new TextView(act);
        label.setText("正在连接下载节点…");
        label.setTextColor(Color.parseColor("#C8CDD8"));
        label.setTextSize(12.5f);
        card.addView(label);

        TextView tip = new TextView(act);
        tip.setText("下载完成后自动校验完整性并安装");
        tip.setTextColor(Color.parseColor("#7E8596"));
        tip.setTextSize(11.5f);
        LinearLayout.LayoutParams tipLp = new LinearLayout.LayoutParams(-1, -2);
        tipLp.topMargin = dp(act, 5);
        card.addView(tip, tipLp);

        attachCardAndShow(act, dlg, card);

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
                    long lastUiMs = 0;
                    try (InputStream in = conn.getInputStream(); FileOutputStream fos = new FileOutputStream(outFile)) {
                        int n;
                        while ((n = in.read(buf)) > 0) {
                            fos.write(buf, 0, n);
                            md.update(buf, 0, n);
                            readSum += n;
                            long nowMs = System.currentTimeMillis();
                            if (total > 0 && (nowMs - lastUiMs > 60 || readSum >= total)) {
                                lastUiMs = nowMs;
                                final int pct = (int) Math.min(100L, (readSum * 100L) / total);
                                final String sizeText = formatBytes(readSum) + " / " + formatBytes(total);
                                ui.post(() -> {
                                    progressClip.setLevel(pct * 100);
                                    pctView.setText(pct + "%");
                                    label.setText("已下载 " + sizeText);
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

    /** 构建统一的无边框暗色半透明遮罩弹窗容器 */
    private static Dialog createStyledDialog(Activity act, boolean cancelable) {
        Dialog dlg = new Dialog(act);
        dlg.requestWindowFeature(Window.FEATURE_NO_TITLE);
        dlg.setCancelable(cancelable);
        dlg.setCanceledOnTouchOutside(cancelable);
        Window w = dlg.getWindow();
        if (w != null) {
            w.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
            w.setDimAmount(0.74f);
            w.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
        }
        return dlg;
    }

    /** 构建深曜石黑与微金描边的圆角卡片根布局 */
    private static LinearLayout buildCardRoot(Activity act) {
        LinearLayout card = new LinearLayout(act);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setBackground(makePill(act, Color.parseColor("#14161D"), Color.parseColor("#38E2B466"), 20));
        int pad = dp(act, 22);
        card.setPadding(pad, pad, pad, pad);
        return card;
    }

    private static void attachCardAndShow(Activity act, Dialog dlg, LinearLayout card) {
        if (isActivityDead(act)) return;
        dlg.setContentView(card);
        dlg.show();
        Window w = dlg.getWindow();
        if (w != null) {
            int sw = act.getResources().getDisplayMetrics().widthPixels;
            int targetW = Math.min(dp(act, 340), Math.round(sw * 0.86f));
            w.setLayout(targetW, WindowManager.LayoutParams.WRAP_CONTENT);
        }
    }

    private static TextView makeActionButton(Activity act, String text, boolean primary) {
        TextView btn = new TextView(act);
        btn.setText(text);
        btn.setGravity(Gravity.CENTER);
        btn.setTextSize(14f);
        btn.setTypeface(Typeface.DEFAULT_BOLD);
        if (primary) {
            btn.setTextColor(Color.parseColor("#151008"));
            btn.setBackground(makeGoldGradient(act, 12));
        } else {
            btn.setTextColor(Color.parseColor("#A9B0BE"));
            btn.setBackground(makePill(act, Color.parseColor("#1E222E"), Color.parseColor("#1FFFFFFF"), 12));
        }
        return btn;
    }

    private static GradientDrawable makePill(Activity act, int bgColor, int strokeColor, int radiusDp) {
        GradientDrawable gd = new GradientDrawable();
        gd.setColor(bgColor);
        gd.setCornerRadius(dp(act, radiusDp));
        if (strokeColor != 0) {
            gd.setStroke(Math.max(1, dp(act, 1)), strokeColor);
        }
        return gd;
    }

    private static GradientDrawable makeGoldGradient(Activity act, int radiusDp) {
        GradientDrawable gd = new GradientDrawable(
                GradientDrawable.Orientation.LEFT_RIGHT,
                new int[]{Color.parseColor("#E8C478"), Color.parseColor("#D49E44")}
        );
        gd.setCornerRadius(dp(act, radiusDp));
        return gd;
    }

    /** 将更新日志多行文本格式化为带暖琥珀圆点的列表文本 */
    private static CharSequence formatBulletNotes(String raw) {
        String text = (raw == null || raw.trim().isEmpty()) ? "性能优化与稳定性提升" : raw.trim();
        String[] lines = text.split("\\r?\\n");
        SpannableStringBuilder ssb = new SpannableStringBuilder();
        int gold = Color.parseColor("#E8C478");
        for (int i = 0; i < lines.length; i++) {
            String line = lines[i].trim();
            if (line.isEmpty()) continue;
            if (ssb.length() > 0) ssb.append('\n');
            if (!line.startsWith("•") && !line.startsWith("-")) {
                int start = ssb.length();
                ssb.append("• ");
                ssb.setSpan(new ForegroundColorSpan(gold), start, start + 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            }
            ssb.append(line);
        }
        return ssb;
    }

    private static String formatBytes(long bytes) {
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1024 * 1024) return String.format(java.util.Locale.US, "%.1f KB", bytes / 1024.0);
        return String.format(java.util.Locale.US, "%.2f MB", bytes / (1024.0 * 1024.0));
    }

    private static int dp(Activity act, int v) {
        return Math.round(v * act.getResources().getDisplayMetrics().density);
    }

    private static boolean isActivityDead(Activity act) {
        if (act == null || act.isFinishing()) return true;
        return Build.VERSION.SDK_INT >= 17 && act.isDestroyed();
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
        if (!isActivityDead(act)) {
            Toast.makeText(act, msg, Toast.LENGTH_SHORT).show();
        }
    }
}
