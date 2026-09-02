package com.advault.tt;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.webkit.WebView;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "AppUpdateInstaller")
public class AppUpdateInstallerPlugin extends Plugin {

    private final AtomicBoolean busy = new AtomicBoolean(false);

    @Override
    public void load() {
        WebView webView = getBridge().getWebView();
        if (webView == null) return;
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            if (!isApkDownload(url, mimeType) || !busy.compareAndSet(false, true)) return;
            new Thread(() -> {
                try {
                    File apk = downloadApk(null, url, contentLength);
                    launchInstaller(apk);
                } catch (Exception ignored) {
                } finally {
                    busy.set(false);
                }
            }).start();
        });
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url", "");
        if (url == null || url.isEmpty()) {
            call.reject("رابط التحديث غير صالح");
            return;
        }
        if (!busy.compareAndSet(false, true)) {
            call.reject("التحديث قيد التنزيل");
            return;
        }
        new Thread(() -> {
            try {
                emit(call, 0, 0, "downloading");
                File apk = downloadApk(call, url, 0);
                emit(call, apk.length(), apk.length(), "installing");
                Activity activity = getActivity();
                if (activity == null) throw new IllegalStateException("النشاط غير جاهز");
                activity.runOnUiThread(() -> {
                    try {
                        ensureCanInstall();
                        launchInstaller(apk);
                        JSObject ok = new JSObject();
                        ok.put("ok", true);
                        call.resolve(ok);
                    } catch (Exception err) {
                        call.reject(err.getMessage() == null ? "تعذر فتح مثبّت Android" : err.getMessage());
                    } finally {
                        busy.set(false);
                    }
                });
            } catch (Exception err) {
                busy.set(false);
                call.reject(err.getMessage() == null ? "تعذر تنزيل التحديث" : err.getMessage());
            }
        }).start();
    }

    private void emit(PluginCall call, long received, long total, String phase) {
        JSObject data = new JSObject();
        data.put("received", received);
        data.put("total", total);
        data.put("phase", phase);
        notifyListeners("progress", data, false);
    }

    private boolean isApkDownload(String url, String mimeType) {
        String lowerUrl = url == null ? "" : url.toLowerCase();
        String mime = mimeType == null ? "" : mimeType.toLowerCase();
        return lowerUrl.contains(".apk")
            || mime.contains("android.package-archive")
            || (mime.contains("octet-stream") && lowerUrl.contains("advault"));
    }

    private File downloadApk(PluginCall call, String source, long hintedLength) throws Exception {
        HttpURLConnection connection = null;
        File folder = new File(getContext().getCacheDir(), "updates");
        if (!folder.exists() && !folder.mkdirs()) {
            throw new IllegalStateException("تعذر حفظ ملف التحديث");
        }
        File apk = new File(folder, "advault-tt.apk");
        try {
            URL url = new URL(source);
            connection = open(url);
            int code = connection.getResponseCode();
            if (code < 200 || code >= 300) {
                throw new IllegalStateException("تعذر تنزيل التحديث");
            }
            long total = connection.getContentLengthLong();
            if (total <= 0) total = hintedLength;
            long received = 0;
            byte[] buffer = new byte[65536];
            try (
                InputStream input = new BufferedInputStream(connection.getInputStream());
                FileOutputStream output = new FileOutputStream(apk)
            ) {
                int n;
                long lastEmit = 0;
                while ((n = input.read(buffer)) != -1) {
                    output.write(buffer, 0, n);
                    received += n;
                    long now = System.currentTimeMillis();
                    if (now - lastEmit > 120) {
                        emit(call, received, total, "downloading");
                        lastEmit = now;
                    }
                }
                output.getFD().sync();
            }
            emit(call, received, Math.max(total, received), "downloading");
            verifyApk(apk);
            return apk;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private HttpURLConnection open(URL url) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setInstanceFollowRedirects(true);
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(60000);
        connection.setRequestProperty("Accept", "application/vnd.android.package-archive,*/*");
        connection.setRequestProperty("Accept-Encoding", "identity");
        connection.setRequestProperty("User-Agent", "ADVAULT-TT-Android");
        connection.connect();
        int code = connection.getResponseCode();
        if (code == HttpURLConnection.HTTP_MOVED_PERM || code == HttpURLConnection.HTTP_MOVED_TEMP || code == 307 || code == 308) {
            String next = connection.getHeaderField("Location");
            connection.disconnect();
            if (next == null || next.isEmpty()) throw new IllegalStateException("تعذر تنزيل التحديث");
            return open(new URL(url, next));
        }
        return connection;
    }

    private void verifyApk(File apk) throws Exception {
        if (apk == null || !apk.isFile() || apk.length() < 64) {
            throw new IllegalStateException("ملف التحديث غير مكتمل");
        }
        try (FileInputStream input = new FileInputStream(apk)) {
            int first = input.read();
            int second = input.read();
            if (first != 0x50 || second != 0x4B) {
                throw new IllegalStateException("ملف التحديث غير صالح");
            }
        }
    }

    private void ensureCanInstall() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        if (getContext().getPackageManager().canRequestPackageInstalls()) return;
        Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
        settings.setData(Uri.parse("package:" + getContext().getPackageName()));
        settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getActivity().startActivity(settings);
        throw new IllegalStateException("فعّل تثبيت التطبيقات من هذا المصدر ثم أعد المحاولة");
    }

    private void launchInstaller(File apk) {
        Uri uri = FileProvider.getUriForFile(
            getContext(),
            getContext().getPackageName() + ".fileprovider",
            apk
        );
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        intent.setClipData(ClipData.newRawUri("", uri));
        PackageManager pm = getContext().getPackageManager();
        List<ResolveInfo> matches = pm.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY);
        for (ResolveInfo match : matches) {
            if (match.activityInfo != null) {
                getContext().grantUriPermission(
                    match.activityInfo.packageName,
                    uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION
                );
            }
        }
        Activity activity = getActivity();
        try {
            if (activity != null) {
                activity.startActivity(intent);
            } else {
                getContext().startActivity(intent);
            }
        } catch (Exception err) {
            try {
                installWithSession(apk);
            } catch (Exception sessionErr) {
                throw new IllegalStateException(
                    sessionErr.getMessage() == null ? "تعذر فتح مثبّت Android" : sessionErr.getMessage()
                );
            }
        }
    }

    private void installWithSession(File apk) throws Exception {
        PackageInstaller installer = getContext().getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(
            PackageInstaller.SessionParams.MODE_FULL_INSTALL
        );
        params.setAppPackageName(getContext().getPackageName());
        int sessionId = installer.createSession(params);
        PackageInstaller.Session session = installer.openSession(sessionId);
        try (FileInputStream input = new FileInputStream(apk);
             OutputStream output = session.openWrite("advault-tt.apk", 0, apk.length())) {
            byte[] buffer = new byte[65536];
            int n;
            while ((n = input.read(buffer)) > 0) {
                output.write(buffer, 0, n);
            }
            session.fsync(output);
        }
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            flags |= PendingIntent.FLAG_MUTABLE;
        }
        PendingIntent pending = PendingIntent.getActivity(
            getContext(),
            sessionId,
            new Intent(getContext(), MainActivity.class),
            flags
        );
        session.commit(pending.getIntentSender());
        session.close();
    }
}
