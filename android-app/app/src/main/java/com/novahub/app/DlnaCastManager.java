package com.novahub.app;

import android.content.Context;
import android.net.wifi.WifiManager;
import android.util.Log;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.StringReader;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;
import org.xmlpull.v1.XmlPullParser;
import org.xmlpull.v1.XmlPullParserFactory;

/**
 * 零第三方依赖 DLNA/UPnP 投屏管理器：
 * 1. 使用 SSDP UDP 组播扫描局域网支持 AVTransport 的电视/盒子；
 * 2. 解析设备描述 XML 获取 friendlyName 与 controlURL；
 * 3. 通过标准 SOAP Action（SetAVTransportURI / Play / Pause / Seek / Stop）实现推流与遥控。
 */
public class DlnaCastManager {
    private static final String TAG = "NovaDlna";
    private static final String SSDP_HOST = "239.255.255.250";
    private static final int SSDP_PORT = 1900;
    private static final String AVT_SERVICE = "urn:schemas-upnp-org:service:AVTransport:1";
    private static final Pattern LOCATION_PAT = Pattern.compile("(?im)^LOCATION:\\s*(.+?)\\s*$");

    public interface DeviceCallback {
        void onResult(JSONArray devices, String error);
    }

    public interface ActionCallback {
        void onDone(boolean ok, String message);
    }

    public static final class Device {
        final String udn;
        final String name;
        final String host;
        final String location;
        final String controlUrl;

        Device(String udn, String name, String host, String location, String controlUrl) {
            this.udn = udn;
            this.name = name;
            this.host = host;
            this.location = location;
            this.controlUrl = controlUrl;
        }

        JSONObject toJson() {
            JSONObject obj = new JSONObject();
            try {
                obj.put("udn", udn);
                obj.put("name", name);
                obj.put("host", host);
                obj.put("location", location);
            } catch (Throwable ignored) {}
            return obj;
        }
    }

    private final Context appContext;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Map<String, Device> devices = new LinkedHashMap<>();
    private volatile Device activeDevice;

    public DlnaCastManager(Context context) {
        this.appContext = context.getApplicationContext();
    }

    /** 异步扫描局域网 DLNA 投屏设备（约 2.8 秒窗口）。 */
    public void scanDevices(DeviceCallback callback) {
        executor.execute(() -> {
            WifiManager.MulticastLock mLock = null;
            List<Device> found = new ArrayList<>();
            String err = null;
            try {
                WifiManager wm = (WifiManager) appContext.getSystemService(Context.WIFI_SERVICE);
                if (wm != null) {
                    mLock = wm.createMulticastLock("NovaHubDlnaLock");
                    mLock.setReferenceCounted(false);
                    mLock.acquire();
                }

                Set<String> locations = discoverLocations();
                for (String loc : locations) {
                    Device dev = fetchDeviceDescription(loc);
                    if (dev != null) {
                        found.add(dev);
                    }
                }
                synchronized (this) {
                    devices.clear();
                    for (Device d : found) {
                        devices.put(d.udn, d);
                    }
                }
            } catch (Throwable e) {
                Log.w(TAG, "DLNA scan failed", e);
                err = e.getMessage() != null ? e.getMessage() : "扫描失败";
            } finally {
                if (mLock != null) {
                    try {
                        if (mLock.isHeld()) mLock.release();
                    } catch (Throwable ignored) {}
                }
            }

            JSONArray arr = new JSONArray();
            for (Device d : found) {
                arr.put(d.toJson());
            }
            if (callback != null) {
                callback.onResult(arr, err);
            }
        });
    }

    /** 将指定媒体直链/代理流推送至选定 DLNA 设备并启动播放。 */
    public void castUrl(String udn, String mediaUrl, String title, ActionCallback callback) {
        executor.execute(() -> {
            if (mediaUrl == null || (!mediaUrl.startsWith("http://") && !mediaUrl.startsWith("https://"))) {
                if (callback != null) callback.onDone(false, "无效的媒体地址");
                return;
            }
            Device dev;
            synchronized (this) {
                dev = devices.get(udn);
            }
            if (dev == null) {
                if (callback != null) callback.onDone(false, "设备已失效，请重新扫描");
                return;
            }
            try {
                // 部分电视需要先 Stop 再重设 URI
                try {
                    sendSoap(dev.controlUrl, "Stop",
                            "<u:Stop xmlns:u=\"" + AVT_SERVICE + "\"><InstanceID>0</InstanceID></u:Stop>");
                } catch (Throwable ignored) {}

                String safeTitle = (title == null || title.trim().isEmpty()) ? "NovaHub 视频" : title.trim();
                String metadata = buildDidlMetadata(mediaUrl, safeTitle);
                String setBody = "<u:SetAVTransportURI xmlns:u=\"" + AVT_SERVICE + "\">"
                        + "<InstanceID>0</InstanceID>"
                        + "<CurrentURI>" + xmlEscape(mediaUrl) + "</CurrentURI>"
                        + "<CurrentURIMetaData>" + xmlEscape(metadata) + "</CurrentURIMetaData>"
                        + "</u:SetAVTransportURI>";
                sendSoap(dev.controlUrl, "SetAVTransportURI", setBody);

                String playBody = "<u:Play xmlns:u=\"" + AVT_SERVICE + "\">"
                        + "<InstanceID>0</InstanceID><Speed>1</Speed></u:Play>";
                sendSoap(dev.controlUrl, "Play", playBody);
                activeDevice = dev;
                if (callback != null) callback.onDone(true, "已推送至 " + dev.name);
            } catch (Throwable e) {
                Log.w(TAG, "DLNA cast failed", e);
                if (callback != null) {
                    callback.onDone(false, "投屏失败：" + (e.getMessage() != null ? e.getMessage() : "设备拒绝连接"));
                }
            }
        });
    }

    /** 控制当前正在投屏的 DLNA 设备（play / pause / stop / seek）。 */
    public void control(String action, String value, ActionCallback callback) {
        executor.execute(() -> {
            Device dev = activeDevice;
            if (dev == null) {
                if (callback != null) callback.onDone(false, "当前未连接 DLNA 设备");
                return;
            }
            String act = action == null ? "" : action.trim().toLowerCase(Locale.US);
            try {
                if ("play".equals(act)) {
                    sendSoap(dev.controlUrl, "Play",
                            "<u:Play xmlns:u=\"" + AVT_SERVICE + "\"><InstanceID>0</InstanceID><Speed>1</Speed></u:Play>");
                    if (callback != null) callback.onDone(true, "已继续播放");
                } else if ("pause".equals(act)) {
                    sendSoap(dev.controlUrl, "Pause",
                            "<u:Pause xmlns:u=\"" + AVT_SERVICE + "\"><InstanceID>0</InstanceID></u:Pause>");
                    if (callback != null) callback.onDone(true, "已暂停");
                } else if ("stop".equals(act)) {
                    sendSoap(dev.controlUrl, "Stop",
                            "<u:Stop xmlns:u=\"" + AVT_SERVICE + "\"><InstanceID>0</InstanceID></u:Stop>");
                    activeDevice = null;
                    if (callback != null) callback.onDone(true, "已停止 DLNA 投屏");
                } else if ("seek".equals(act)) {
                    int sec = 0;
                    try { sec = Math.max(0, (int) Math.round(Double.parseDouble(value))); } catch (Throwable ignored) {}
                    String target = formatHms(sec);
                    sendSoap(dev.controlUrl, "Seek",
                            "<u:Seek xmlns:u=\"" + AVT_SERVICE + "\">"
                                    + "<InstanceID>0</InstanceID>"
                                    + "<Unit>REL_TIME</Unit>"
                                    + "<Target>" + target + "</Target>"
                                    + "</u:Seek>");
                    if (callback != null) callback.onDone(true, "已跳转至 " + target);
                } else {
                    if (callback != null) callback.onDone(false, "不支持的遥控操作");
                }
            } catch (Throwable e) {
                Log.w(TAG, "DLNA control failed", e);
                if (callback != null) callback.onDone(false, "遥控指令失败");
            }
        });
    }

    public void shutdown() {
        executor.shutdownNow();
    }

    private Set<String> discoverLocations() throws Exception {
        Set<String> locations = new LinkedHashSet<>();
        DatagramSocket socket = null;
        try {
            socket = new DatagramSocket(null);
            socket.setReuseAddress(true);
            socket.bind(new InetSocketAddress(0));
            socket.setSoTimeout(500);
            InetAddress group = InetAddress.getByName(SSDP_HOST);

            String[] searchTargets = new String[] {
                    AVT_SERVICE,
                    "urn:schemas-upnp-org:device:MediaRenderer:1"
            };
            for (int round = 0; round < 2; round++) {
                for (String st : searchTargets) {
                    String msg = "M-SEARCH * HTTP/1.1\r\n"
                            + "HOST: 239.255.255.250:1900\r\n"
                            + "MAN: \"ssdp:discover\"\r\n"
                            + "MX: 2\r\n"
                            + "ST: " + st + "\r\n\r\n";
                    byte[] data = msg.getBytes(StandardCharsets.UTF_8);
                    socket.send(new DatagramPacket(data, data.length, group, SSDP_PORT));
                }
            }

            long deadline = System.currentTimeMillis() + 2600L;
            byte[] buf = new byte[4096];
            while (System.currentTimeMillis() < deadline) {
                try {
                    DatagramPacket pkt = new DatagramPacket(buf, buf.length);
                    socket.receive(pkt);
                    String resp = new String(pkt.getData(), 0, pkt.getLength(), StandardCharsets.UTF_8);
                    Matcher m = LOCATION_PAT.matcher(resp);
                    if (m.find()) {
                        String loc = m.group(1).trim();
                        if (loc.startsWith("http://") || loc.startsWith("https://")) {
                            locations.add(loc);
                        }
                    }
                } catch (java.net.SocketTimeoutException ignored) {
                    // 等待下一个到达的 SSDP 响应直到时间窗口结束
                }
            }
        } finally {
            if (socket != null) {
                try { socket.close(); } catch (Throwable ignored) {}
            }
        }
        return locations;
    }

    private Device fetchDeviceDescription(String location) {
        try {
            String xml = httpGetText(location, 3000);
            if (xml == null || xml.isEmpty()) return null;

            XmlPullParserFactory factory = XmlPullParserFactory.newInstance();
            factory.setNamespaceAware(true);
            XmlPullParser parser = factory.newPullParser();
            parser.setInput(new StringReader(xml));

            String urlBase = "";
            String friendlyName = "";
            String udn = "";
            String avtControl = "";
            boolean inService = false;
            String curServiceType = "";
            String curControlUrl = "";
            String currentTag = "";

            int ev = parser.getEventType();
            while (ev != XmlPullParser.END_DOCUMENT) {
                if (ev == XmlPullParser.START_TAG) {
                    currentTag = parser.getName();
                    if ("service".equalsIgnoreCase(currentTag)) {
                        inService = true;
                        curServiceType = "";
                        curControlUrl = "";
                    }
                } else if (ev == XmlPullParser.TEXT) {
                    String txt = parser.getText();
                    if (txt != null) {
                        txt = txt.trim();
                        if ("URLBase".equalsIgnoreCase(currentTag) && urlBase.isEmpty()) {
                            urlBase = txt;
                        } else if ("friendlyName".equalsIgnoreCase(currentTag) && friendlyName.isEmpty()) {
                            friendlyName = txt;
                        } else if ("UDN".equalsIgnoreCase(currentTag) && udn.isEmpty()) {
                            udn = txt;
                        } else if (inService && "serviceType".equalsIgnoreCase(currentTag)) {
                            curServiceType = txt;
                        } else if (inService && "controlURL".equalsIgnoreCase(currentTag)) {
                            curControlUrl = txt;
                        }
                    }
                } else if (ev == XmlPullParser.END_TAG) {
                    if ("service".equalsIgnoreCase(parser.getName())) {
                        if (curServiceType.contains("AVTransport") && !curControlUrl.isEmpty() && avtControl.isEmpty()) {
                            avtControl = curControlUrl;
                        }
                        inService = false;
                    }
                    currentTag = "";
                }
                ev = parser.next();
            }

            if (avtControl.isEmpty()) return null;
            URI baseUri = URI.create(urlBase.isEmpty() ? location : urlBase);
            String absControl = baseUri.resolve(avtControl).toString();
            String host = baseUri.getHost() != null ? baseUri.getHost() : "";
            String finalUdn = udn.isEmpty() ? absControl : udn;
            String finalName = friendlyName.isEmpty() ? ("DLNA 设备 (" + host + ")") : friendlyName;
            return new Device(finalUdn, finalName, host, location, absControl);
        } catch (Throwable e) {
            Log.d(TAG, "Ignore non-AVTransport device " + location);
            return null;
        }
    }

    private static String httpGetText(String urlStr, int timeoutMs) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
        conn.setConnectTimeout(timeoutMs);
        conn.setReadTimeout(timeoutMs);
        conn.setRequestMethod("GET");
        try {
            if (conn.getResponseCode() >= 400) return "";
            try (InputStream in = conn.getInputStream();
                 ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buf = new byte[4096];
                int n;
                int total = 0;
                while ((n = in.read(buf)) > 0) {
                    total += n;
                    if (total > 262144) break;
                    out.write(buf, 0, n);
                }
                return out.toString(StandardCharsets.UTF_8.name());
            }
        } finally {
            conn.disconnect();
        }
    }

    private static void sendSoap(String controlUrl, String action, String bodyXml) throws Exception {
        String envelope = "<?xml version=\"1.0\" encoding=\"utf-8\"?>"
                + "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" "
                + "s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\">"
                + "<s:Body>" + bodyXml + "</s:Body>"
                + "</s:Envelope>";
        byte[] payload = envelope.getBytes(StandardCharsets.UTF_8);
        HttpURLConnection conn = (HttpURLConnection) new URL(controlUrl).openConnection();
        conn.setConnectTimeout(5000);
        conn.setReadTimeout(5000);
        conn.setDoOutput(true);
        conn.setRequestMethod("POST");
        conn.setRequestProperty("Content-Type", "text/xml; charset=\"utf-8\"");
        conn.setRequestProperty("SOAPACTION", "\"" + AVT_SERVICE + "#" + action + "\"");
        try {
            try (OutputStream os = conn.getOutputStream()) {
                os.write(payload);
            }
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) {
                throw new IllegalStateException("HTTP " + code);
            }
        } finally {
            conn.disconnect();
        }
    }

    private static String buildDidlMetadata(String mediaUrl, String title) {
        return "<DIDL-Lite xmlns=\"urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/\" "
                + "xmlns:dc=\"http://purl.org/dc/elements/1.1/\" "
                + "xmlns:upnp=\"urn:schemas-upnp-org:metadata-1-0/upnp/\">"
                + "<item id=\"0\" parentID=\"-1\" restricted=\"1\">"
                + "<dc:title>" + xmlEscape(title) + "</dc:title>"
                + "<upnp:class>object.item.videoItem</upnp:class>"
                + "<res protocolInfo=\"http-get:*:video/*:*\">" + xmlEscape(mediaUrl) + "</res>"
                + "</item></DIDL-Lite>";
    }

    private static String xmlEscape(String raw) {
        if (raw == null) return "";
        return raw.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&apos;");
    }

    private static String formatHms(int totalSec) {
        int h = totalSec / 3600;
        int m = (totalSec % 3600) / 60;
        int s = totalSec % 60;
        return String.format(Locale.US, "%02d:%02d:%02d", h, m, s);
    }
}
