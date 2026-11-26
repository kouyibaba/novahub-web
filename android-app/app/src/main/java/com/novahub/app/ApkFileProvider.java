package com.novahub.app;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;

/**
 * 零依赖轻量 APK 安装文件 Provider，仅允许只读访问私有 update 目录下的安装包
 */
public class ApkFileProvider extends ContentProvider {
    public static final String AUTHORITY = "com.novahub.app.apkprovider";

    /** 生成对外安全授权 URI */
    public static Uri getApkUri(Context ctx, File apkFile) {
        return new Uri.Builder()
                .scheme("content")
                .authority(AUTHORITY)
                .appendPath("update")
                .appendPath(apkFile.getName())
                .build();
    }

    /** 校验并解析目标 APK 路径，防止路径穿越 */
    private File resolveSafeApk(Uri uri) throws FileNotFoundException {
        Context ctx = getContext();
        if (ctx == null) throw new FileNotFoundException("Missing context");
        if (uri.getPathSegments().size() != 2 || !"update".equals(uri.getPathSegments().get(0))) {
            throw new FileNotFoundException("Invalid path");
        }
        String name = uri.getPathSegments().get(1);
        if (name == null || !name.endsWith(".apk") || name.contains("/") || name.contains("..")) {
            throw new FileNotFoundException("Invalid apk name");
        }
        File updateDir = new File(ctx.getExternalFilesDir(null), "update");
        File target = new File(updateDir, name);
        try {
            String dirCanon = updateDir.getCanonicalPath();
            String fileCanon = target.getCanonicalPath();
            if (!fileCanon.startsWith(dirCanon + File.separator) || !target.isFile()) {
                throw new FileNotFoundException("File not found");
            }
        } catch (IOException e) {
            throw new FileNotFoundException(e.getMessage());
        }
        return target;
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        try {
            File file = resolveSafeApk(uri);
            String[] cols = projection != null ? projection : new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};
            MatrixCursor cursor = new MatrixCursor(cols, 1);
            Object[] row = new Object[cols.length];
            for (int i = 0; i < cols.length; i++) {
                if (OpenableColumns.DISPLAY_NAME.equals(cols[i])) row[i] = file.getName();
                else if (OpenableColumns.SIZE.equals(cols[i])) row[i] = file.length();
            }
            cursor.addRow(row);
            return cursor;
        } catch (FileNotFoundException e) {
            return new MatrixCursor(new String[0], 0);
        }
    }

    @Override
    public String getType(Uri uri) {
        return "application/vnd.android.package-archive";
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode)) throw new FileNotFoundException("Read only");
        File file = resolveSafeApk(uri);
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) { return null; }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) { return 0; }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) { return 0; }
}
