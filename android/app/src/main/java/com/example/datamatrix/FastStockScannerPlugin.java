package com.example.datamatrix;

import android.content.Intent;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.content.ContentValues;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(name = "FastStockScannerPlugin")
public class FastStockScannerPlugin extends Plugin {

    // Şu anda devam eden tek bir FAST isteğini tutmak için
    private static PluginCall pendingCall;

    @PluginMethod
    public void startMultiScan(PluginCall call) {
        // Aynı anda ikinci bir isteğe izin vermeyelim; varsa reddet
        if (pendingCall != null) {
            call.reject("Zaten devam eden bir tarama isteği var.");
            return;
        }

        pendingCall = call;

        Intent intent = new Intent(getContext(), FastMultiScanActivity.class);
        // Süre parametresi (ms cinsinden)
        long durationMs = call.getLong("durationMs", 3000L);
        intent.putExtra("durationMs", durationMs);

        // Not sormayı atlama parametresi
        boolean skipNote = call.getBoolean("skipNote", false);
        intent.putExtra("skipNote", skipNote);

        getActivity().startActivity(intent);
    }

    /**
     * FastMultiScanActivity tamamlandığında çağrılır.
     */
    public static void finishMultiScan(JSONArray codes) {
        if (pendingCall == null) return;

        PluginCall call = pendingCall;

        JSArray arr = new JSArray();
        if (codes != null) {
            for (int i = 0; i < codes.length(); i++) {
                String code = codes.optString(i, null);
                if (code != null) {
                    arr.put(code);
                }
            }
        }

        JSObject ret = new JSObject();
        ret.put("barcodes", arr);

        pendingCall.resolve(ret);
        pendingCall = null;
    }

    // Kayıtlı sayım oturumlarını SQLite'ten okuyup JS'e döndürür
    @PluginMethod
    public void getScanSessions(PluginCall call) {
        try {
            ScanDatabaseHelper dbHelper = ScanDatabaseHelper.getInstance(getContext());
            SQLiteDatabase db = dbHelper.getReadableDatabase();

            Cursor c = db.rawQuery(
                    "SELECT id, created_at, note, total_count, device_id " +
                            "FROM scan_sessions ORDER BY created_at DESC",
                    null
            );

            JSArray sessions = new JSArray();
            while (c.moveToNext()) {
                JSObject o = new JSObject();
                o.put("id", c.getLong(0));
                o.put("created_at", c.getString(1));
                o.put("note", c.isNull(2) ? null : c.getString(2));
                o.put("total_count", c.getInt(3));
                o.put("device_id", c.isNull(4) ? null : c.getString(4));
                sessions.put(o);
            }
            c.close();

            JSObject result = new JSObject();
            result.put("sessions", sessions);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Scan sessions okunurken hata: " + e.getMessage());
        }
    }

    // Belirli bir oturumun (scan_sessions.id) altındaki kodları döndürür
    @PluginMethod
    public void getScanSessionItems(PluginCall call) {
        Long sessionId = call.getLong("sessionId");
        if (sessionId == null) {
            call.reject("sessionId parametresi zorunlu");
            return;
        }

        try {
            ScanDatabaseHelper dbHelper = ScanDatabaseHelper.getInstance(getContext());
            SQLiteDatabase db = dbHelper.getReadableDatabase();

            Cursor c = db.rawQuery(
                    "SELECT id, code, scanned_at, gtin " +
                            "FROM scan_items WHERE session_id = ? ORDER BY id ASC",
                    new String[]{String.valueOf(sessionId)}
            );

            JSArray items = new JSArray();
            while (c.moveToNext()) {
                JSObject o = new JSObject();
                o.put("id", c.getLong(0));
                o.put("code", c.getString(1));
                o.put("scanned_at", c.getString(2));
                o.put("gtin", c.isNull(3) ? null : c.getString(3));
                items.put(o);
            }
            c.close();

            JSObject result = new JSObject();
            result.put("items", items);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Scan session items okunurken hata: " + e.getMessage());
        }
    }

    // Oturum ve bağlı scan_items kayıtlarını siler
    @PluginMethod
    public void deleteScanSession(PluginCall call) {
        Long sessionId = call.getLong("sessionId");
        if (sessionId == null) {
            call.reject("sessionId parametresi zorunlu");
            return;
        }

        try {
            ScanDatabaseHelper dbHelper = ScanDatabaseHelper.getInstance(getContext());
            int deleted = dbHelper.deleteSession(sessionId);
            JSObject result = new JSObject();
            result.put("deleted", deleted);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Scan session silinirken hata: " + e.getMessage());
        }
    }

    // ================== STOK RAPORU ==================
    @PluginMethod
    public void getStockReport(PluginCall call) {
        try {
            // JS’ten gelen sessionIds array’ini al
            JSArray sessionIdsArr = call.getArray("sessionIds");
            if (sessionIdsArr == null || sessionIdsArr.length() == 0) {
                call.reject("sessionIds parametresi zorunlu ve en az bir id içermeli.");
                return;
            }

            List<Long> sessionIds = new ArrayList<>();
            for (int i = 0; i < sessionIdsArr.length(); i++) {
                try {
                    long id = sessionIdsArr.getLong(i);
                    if (id > 0) {
                        sessionIds.add(id);
                    }
                } catch (Exception ignored) {
                }
            }

            if (sessionIds.isEmpty()) {
                call.reject("Geçerli sessionIds bulunamadı.");
                return;
            }

            ScanDatabaseHelper dbHelper = ScanDatabaseHelper.getInstance(getContext());
            SQLiteDatabase db = dbHelper.getReadableDatabase();

            // Dinamik IN (?) listesi
            StringBuilder sb = new StringBuilder();
            sb.append("SELECT s.gtin, p.brand_name, ");
            sb.append("COUNT(DISTINCT s.code) AS distinctCount, ");
            sb.append("COUNT(s.code) AS totalScans ");
            sb.append("FROM scan_items s ");
            sb.append("LEFT JOIN products_local p ON p.gtin = s.gtin ");
            sb.append("WHERE s.session_id IN (");

            String[] args = new String[sessionIds.size()];
            for (int i = 0; i < sessionIds.size(); i++) {
                if (i > 0) sb.append(",");
                sb.append("?");
                args[i] = String.valueOf(sessionIds.get(i));
            }
            sb.append(") ");
            sb.append("GROUP BY s.gtin, p.brand_name ");
            sb.append("ORDER BY p.brand_name IS NULL, p.brand_name ASC;");

            Cursor c = db.rawQuery(sb.toString(), args);

            JSArray items = new JSArray();
            int totalDistinct = 0;
            int totalScans = 0;

            while (c.moveToNext()) {
                String gtin = c.isNull(0) ? null : c.getString(0);
                String brandName = c.isNull(1) ? null : c.getString(1);
                int distinctCount = c.getInt(2);
                int scans = c.getInt(3);

                totalDistinct += distinctCount;
                totalScans += scans;

                JSObject row = new JSObject();
                row.put("gtin", gtin);
                row.put("brand_name", brandName);
                row.put("distinctCount", distinctCount);
                row.put("totalScans", scans);

                items.put(row);
            }
            c.close();

            JSObject result = new JSObject();
            result.put("items", items);
            result.put("totalDistinct", totalDistinct);
            result.put("totalScans", totalScans);
            result.put("duplicateCount", totalScans - totalDistinct);

            call.resolve(result);
        } catch (Exception e) {
            call.reject("Stok raporu oluşturulurken hata: " + e.getMessage());
        }
    }

    // EASY satış kayıtlarını özet olarak döner
    @PluginMethod
    public void getEasySales(PluginCall call) {
        try {
            ScanDatabaseHelper dbHelper = ScanDatabaseHelper.getInstance(getContext());
            // Liste okumak için read-only yeterli
            SQLiteDatabase db = dbHelper.getReadableDatabase();

            // Tüm EASY satışlarını (en son eklenen en üstte olacak şekilde) çekiyoruz
            Cursor c = db.rawQuery(
                    "SELECT s.id, s.created_at, " +
                            " (SELECT COUNT(*) FROM easy_sale_items ei WHERE ei.sale_id = s.id) AS item_count, " +
                            " s.note " +
                            "FROM easy_sales s " +
                            "ORDER BY s.id DESC",
                    null
            );

            JSArray arr = new JSArray();

            while (c.moveToNext()) {
                JSObject o = new JSObject();
                o.put("id", c.getInt(0));
                o.put("created_at", c.getString(1));
                o.put("item_count", c.getInt(2));
                // NOT alanını da JSON'a ekleyelim (null ise boş string)
                o.put("note", c.isNull(3) ? "" : c.getString(3));
                arr.put(o);
            }
            c.close();

            JSObject result = new JSObject();
            result.put("sales", arr);

            call.resolve(result);
        } catch (Exception e) {
            call.reject("Easy satış kayıtları okunamadı: " + e.getMessage());
        }
    }

    // Belirli bir EASY satış kaydının detayını döner (başlık + kalemler)
    @PluginMethod
    public void getEasySaleDetail(PluginCall call) {
        JSObject data = call.getData();

        // id parametresini al (id veya saleId)
        Long id = call.getLong("id");
        if (id == null) {
            id = call.getLong("saleId");
        }

        if (id == null && data != null) {
            long optId = data.optLong("id", -1L);
            if (optId <= 0) {
                optId = data.optLong("saleId", -1L);
            }
            if (optId > 0) {
                id = optId;
            }
        }

        if (id == null || id <= 0) {
            call.reject("Geçersiz id / saleId parametresi");
            return;
        }

        try {
            ScanDatabaseHelper dbHelper = ScanDatabaseHelper.getInstance(getContext());
            SQLiteDatabase db = dbHelper.getReadableDatabase();

            // Önce easy_sales başlığını oku
            Cursor h = db.rawQuery(
                    "SELECT id, created_at, patient, citizen_id, prescription_number, note, device_id " +
                            "FROM easy_sales WHERE id = ? LIMIT 1",
                    new String[]{String.valueOf(id)}
            );

            if (!h.moveToFirst()) {
                h.close();
                call.reject("easy satış kaydı bulunamadı: " + id);
                return;
            }

            JSObject result = new JSObject();
            result.put("id", h.getLong(0));
            result.put("createdAt", h.getString(1));
            result.put("patient", h.isNull(2) ? null : h.getString(2));
            result.put("citizenId", h.isNull(3) ? null : h.getString(3));
            result.put("prescriptionNumber", h.isNull(4) ? null : h.getString(4));
            result.put("note", h.isNull(5) ? null : h.getString(5));
            result.put("deviceId", h.isNull(6) ? null : h.getString(6));
            h.close();

            // Şimdi easy_sale_items kalemlerini oku
            Cursor c = db.rawQuery(
                    "SELECT id, barcode, brand, sn, status, description, note, unit_price, partial_amount, ndb_success, ndb_message " +
                            "FROM easy_sale_items WHERE sale_id = ? ORDER BY id ASC",
                    new String[]{String.valueOf(id)}
            );

            JSArray itemsArr = new JSArray();
            while (c.moveToNext()) {
                JSObject item = new JSObject();
                item.put("id", c.getLong(0));
                item.put("barcode", c.isNull(1) ? null : c.getString(1));
                item.put("brand", c.isNull(2) ? null : c.getString(2));
                item.put("sn", c.isNull(3) ? null : c.getString(3));
                item.put("status", c.isNull(4) ? null : c.getString(4));
                item.put("description", c.isNull(5) ? null : c.getString(5));
                item.put("note", c.isNull(6) ? null : c.getString(6));
                item.put("unitPrice", c.isNull(7) ? null : c.getString(7));
                item.put("partialAmount", c.isNull(8) ? null : c.getString(8));

                // NDB sonuçlarını da JSON'a ekle
                if (!c.isNull(9)) {
                    item.put("ndbSuccess", c.getInt(9) == 1);
                } else {
                    item.put("ndbSuccess", null);
                }
                item.put("ndbMessage", c.isNull(10) ? null : c.getString(10));

                itemsArr.put(item);
            }
            c.close();

            result.put("items", itemsArr);

            call.resolve(result);
        } catch (Exception e) {
            call.reject("Easy satış detayı okunamadı: " + e.getMessage());
        }
    }

    @PluginMethod
    public void saveEasySale(PluginCall call) {
        try {
            // JS tarafında FastStockScanner.saveEasySale({...}) ile gelen veriyi al
            JSObject data = call.getData();
            if (data == null) {
                call.reject("Eksik veri: data yok");
                return;
            }

            String createdAt = data.optString("createdAt", null);
            if (createdAt == null || createdAt.isEmpty()) {
                call.reject("createdAt eksik");
                return;
            }

            // items: [{ barcode, brand, sn, status, description, note, unitPrice, partialAmount, ndbSuccess, ndbMessage }, ...]
            org.json.JSONArray items;
            try {
                items = data.getJSONArray("items");
            } catch (Exception e) {
                call.reject("items alanı JSON array değil veya yok: " + e.getMessage());
                return;
            }

            if (items == null || items.length() == 0) {
                call.reject("En az bir item olmalı");
                return;
            }

            String patient = data.optString("patient", null);
            String citizenId = data.optString("citizenId", null);
            String prescriptionNumber = data.optString("prescriptionNumber", null);
            String note = data.optString("note", null);

            // Cihaz kimliği (şimdilik boş geçilebilir)
            String deviceId = data.optString("deviceId", null);

            ScanDatabaseHelper dbHelper = ScanDatabaseHelper.getInstance(getContext());
            SQLiteDatabase db = dbHelper.getWritableDatabase();

            // easy_sales kaydı ekle
            long saleId = dbHelper.insertEasySale(
                    createdAt,
                    patient,
                    citizenId,
                    prescriptionNumber,
                    note,
                    deviceId
            );

            if (saleId <= 0) {
                call.reject("easy_sales kaydı oluşturulamadı");
                return;
            }

            // easy_sale_items için detaylı kalemleri ekle (barcode + brand + sn + status + description + note + unit_price + partial_amount + NDB sonuçları)
            db.beginTransaction();
            try {
                for (int i = 0; i < items.length(); i++) {
                    org.json.JSONObject o = items.getJSONObject(i);
                    String barcode = o.optString("barcode", null);
                    if (barcode == null || barcode.isEmpty()) {
                        continue;
                    }

                    String brand = o.optString("brand", null);
                    String sn = o.optString("sn", null);
                    String status = o.optString("status", null);
                    String description = o.optString("description", null);
                    String itemNote = o.optString("note", null);
                    String unitPrice = o.optString("unitPrice", null);
                    String partialAmount = o.optString("partialAmount", null);

                    // NDB bildirim sonucu (frontend gönderirse kaydedelim)
                    boolean hasNdbSuccess = o.has("ndbSuccess");
                    boolean ndbSuccess = o.optBoolean("ndbSuccess", false);
                    String ndbMessage = o.optString("ndbMessage", null);

                    ContentValues cv = new ContentValues();
                    cv.put("sale_id", saleId);
                    cv.put("barcode", barcode);
                    if (brand != null) cv.put("brand", brand);
                    if (sn != null) cv.put("sn", sn);
                    if (status != null) cv.put("status", status);
                    if (description != null) cv.put("description", description);
                    if (itemNote != null) cv.put("note", itemNote);
                    if (unitPrice != null && !unitPrice.isEmpty()) cv.put("unit_price", unitPrice);
                    if (partialAmount != null && !partialAmount.isEmpty()) cv.put("partial_amount", partialAmount);

                    if (hasNdbSuccess) {
                        cv.put("ndb_success", ndbSuccess ? 1 : 0);
                    }
                    if (ndbMessage != null && !ndbMessage.isEmpty()) {
                        cv.put("ndb_message", ndbMessage);
                    }

                    db.insert("easy_sale_items", null, cv);
                }

                db.setTransactionSuccessful();
            } finally {
                db.endTransaction();
            }

            JSObject result = new JSObject();
            result.put("saleId", saleId);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("EasySale sırasında hata: " + e.getMessage());
        }
    }
}
