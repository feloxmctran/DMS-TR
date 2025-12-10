package com.example.datamatrix;

import android.content.Context;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.content.ContentValues;
import android.database.Cursor;

import androidx.annotation.Nullable;

import java.util.List;

/**
 * Cihaz içi sayım veritabanı:
 *
 * 1) scan_sessions: Her "Kaydet" işlemi için 1 satır
 *    - id INTEGER PRIMARY KEY AUTOINCREMENT
 *    - created_at TEXT (ISO 8601)
 *    - note TEXT (isteğe bağlı açıklama)
 *    - total_count INTEGER (kaç kod okundu)
 *    - device_id TEXT (hangi telefonda kaydedildi)
 *
 * 2) scan_items: Her okunan barkod için 1 satır
 *    - id INTEGER PRIMARY KEY AUTOINCREMENT
 *    - session_id INTEGER (scan_sessions.id ile ilişkili)
 *    - code TEXT (datamatrix string'i)
 *    - gtin TEXT (üründen çözülmüş GTIN, stok raporu için)
 *    - scanned_at TEXT
 *
 * 3) products_local: Ürün kataloğu (GTIN -> BrandName)
 *    - gtin TEXT PRIMARY KEY
 *    - brand_name TEXT NOT NULL
 *
 * 4) easy_sales / easy_sale_items:
 *    - Easy satış başlıkları ve kalemleri
 */
public class ScanDatabaseHelper extends SQLiteOpenHelper {

    private static final String DB_NAME = "scan_sessions.db";
    // Şema sürümü: 5 (gtin, products_local, easy_sales, easy_sale_items + easy_item fiyat alanları dahil)
    private static final int DB_VERSION = 6;

    private static ScanDatabaseHelper instance;

    public static synchronized ScanDatabaseHelper getInstance(Context context) {
        if (instance == null) {
            instance = new ScanDatabaseHelper(context.getApplicationContext());
        }
        return instance;
    }

    private ScanDatabaseHelper(@Nullable Context context) {
        super(context, DB_NAME, null, DB_VERSION);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        // Oturum tablosu
        db.execSQL(
                "CREATE TABLE IF NOT EXISTS scan_sessions (" +
                        "id INTEGER PRIMARY KEY AUTOINCREMENT," +
                        "created_at TEXT NOT NULL," +
                        "note TEXT," +
                        "total_count INTEGER NOT NULL," +
                        "device_id TEXT" +
                        ");"
        );

        // Oturum içi kodlar
        db.execSQL(
                "CREATE TABLE IF NOT EXISTS scan_items (" +
                        "id INTEGER PRIMARY KEY AUTOINCREMENT," +
                        "session_id INTEGER NOT NULL," +
                        "code TEXT NOT NULL," +
                        "gtin TEXT," +
                        "scanned_at TEXT NOT NULL," +
                        "FOREIGN KEY(session_id) REFERENCES scan_sessions(id) ON DELETE CASCADE" +
                        ");"
        );

        // code + session_id üzerinde index (rapor için hızlı sayım)
        db.execSQL(
                "CREATE INDEX IF NOT EXISTS idx_scan_items_session_code " +
                        "ON scan_items(session_id, code);"
        );

        // FAST ürün kataloğu tablosu (GTIN -> BrandName)
        db.execSQL(
                "CREATE TABLE IF NOT EXISTS products_local (" +
                        "gtin TEXT PRIMARY KEY," +
                        "brand_name TEXT NOT NULL" +
                        ");"
        );

        // EASY satış kayıtları (reçete satış başlığı)
        db.execSQL(
                "CREATE TABLE IF NOT EXISTS easy_sales (" +
                        "id INTEGER PRIMARY KEY AUTOINCREMENT," +
                        "created_at TEXT NOT NULL," +
                        "patient TEXT," +
                        "citizen_id TEXT," +
                        "prescription_number TEXT," +
                        "note TEXT," +
                        "device_id TEXT" +
                        ");"
        );

        // EASY satış kayıtlarının kalemleri (ilaçlar)
        db.execSQL(
                "CREATE TABLE IF NOT EXISTS easy_sale_items (" +
                        "id INTEGER PRIMARY KEY AUTOINCREMENT," +
                        "sale_id INTEGER NOT NULL," +
                        "barcode TEXT NOT NULL," +
                        "brand TEXT," +
                        "sn TEXT," +
                        "status TEXT," +
                        "description TEXT," +
                        "note TEXT," +
                        "unit_price TEXT," +
                        "partial_amount TEXT," +
                        "ndb_success INTEGER," +
                        "ndb_message TEXT," +
                        "FOREIGN KEY(sale_id) REFERENCES easy_sales(id) ON DELETE CASCADE" +
                        ");"
        );

    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        // VERİ SİLME YOK — sadece eksik kolon/tablo/index ekliyoruz.

        // v1 → v2: scan_sessions.device_id kolonu ekle
        if (oldVersion < 2) {
            try {
                db.execSQL("ALTER TABLE scan_sessions ADD COLUMN device_id TEXT;");
            } catch (Exception ignored) {
            }

            // Eski v1 kurulumlarında index yoksa ekleyelim
            try {
                db.execSQL(
                        "CREATE INDEX IF NOT EXISTS idx_scan_items_session_code " +
                                "ON scan_items(session_id, code);"
                );
            } catch (Exception ignored) {
            }
        }

        // v2 → v3: scan_items.gtin ve products_local tablosu
        if (oldVersion < 3) {
            try {
                db.execSQL("ALTER TABLE scan_items ADD COLUMN gtin TEXT;");
            } catch (Exception ignored) {
            }

            try {
                db.execSQL(
                        "CREATE TABLE IF NOT EXISTS products_local (" +
                                "gtin TEXT PRIMARY KEY," +
                                "brand_name TEXT NOT NULL" +
                                ");"
                );
            } catch (Exception ignored) {
            }
        }

        // v3 → v4: easy_sales ve easy_sale_items tabloları
        if (oldVersion < 4) {
            try {
                db.execSQL(
                        "CREATE TABLE IF NOT EXISTS easy_sales (" +
                                "id INTEGER PRIMARY KEY AUTOINCREMENT," +
                                "created_at TEXT NOT NULL," +
                                "patient TEXT," +
                                "citizen_id TEXT," +
                                "prescription_number TEXT," +
                                "note TEXT," +
                                "device_id TEXT" +
                                ");"
                );
            } catch (Exception ignored) {
            }

            try {
                db.execSQL(
                        "CREATE TABLE IF NOT EXISTS easy_sale_items (" +
                                "id INTEGER PRIMARY KEY AUTOINCREMENT," +
                                "sale_id INTEGER NOT NULL," +
                                "barcode TEXT NOT NULL," +
                                "brand TEXT," +
                                "sn TEXT," +
                                "status TEXT," +
                                "description TEXT," +
                                "note TEXT," +
                                "FOREIGN KEY(sale_id) REFERENCES easy_sales(id) ON DELETE CASCADE" +
                                ");"
                );
            } catch (Exception ignored) {
            }
        }

        // v5 → v6: easy_sale_items tablosuna NDB sonuç kolonlarını ekle
        if (oldVersion < 6) {
            try {
                db.execSQL("ALTER TABLE easy_sale_items ADD COLUMN ndb_success INTEGER;");
            } catch (Exception ignored) {
            }
            try {
                db.execSQL("ALTER TABLE easy_sale_items ADD COLUMN ndb_message TEXT;");
            } catch (Exception ignored) {
            }
        }


        // v4 → v5: easy_sale_items tablosuna fiyat kolonlarını ekle
        if (oldVersion < 5) {
            try {
                db.execSQL("ALTER TABLE easy_sale_items ADD COLUMN unit_price TEXT;");
            } catch (Exception ignored) {
            }
            try {
                db.execSQL("ALTER TABLE easy_sale_items ADD COLUMN partial_amount TEXT;");
            } catch (Exception ignored) {
            }
        }

        // İleride yeni versiyonlar için:
// if (oldVersion < 7) { ... }
    }

    /**
     * Yeni bir sayım oturumu ekler.
     *
     * @param createdAt  ISO 8601 tarih-saat (örn: "2025-11-23T14:30:00")
     * @param note       Kullanıcı notu (şimdilik null/boş geçilebilir)
     * @param totalCount Toplam kod adedi
     * @param deviceId   Hangi telefonda kaydedildi
     * @return insert edilen session id (veya -1 hata)
     */
    public long insertSession(String createdAt,
                              @Nullable String note,
                              int totalCount,
                              @Nullable String deviceId) {
        SQLiteDatabase db = getWritableDatabase();
        ContentValues cv = new ContentValues();
        cv.put("created_at", createdAt);
        cv.put("note", note);
        cv.put("total_count", totalCount);
        cv.put("device_id", deviceId);
        return db.insert("scan_sessions", null, cv);
    }

    /**
     * Datamatrix / NDB string'inden GTIN-13 çıkarır.
     * Senin kuralına göre: "010" + 13 hane = GTIN.
     * Örnek: 01076134211482632110...  -> 7613421148263
     */
    @Nullable
    public static String extractGtinFromCode(@Nullable String code) {
        if (code == null) return null;
        int idx = code.indexOf("010");
        if (idx < 0) return null;
        int start = idx + 3;
        if (code.length() < start + 13) return null;
        String gtin13 = code.substring(start, start + 13);
        // Basit kontrol: sadece rakam olsun
        for (int i = 0; i < gtin13.length(); i++) {
            char ch = gtin13.charAt(i);
            if (ch < '0' || ch > '9') return null;
        }
        return gtin13;
    }

    /**
     * FAST stok raporu için scan_items tablosuna satır ekler.
     */
    public long insertScanItem(long sessionId,
                               String code,
                               @Nullable String gtin,
                               String scannedAt) {
        SQLiteDatabase db = getWritableDatabase();
        ContentValues cv = new ContentValues();
        cv.put("session_id", sessionId);
        cv.put("code", code);
        cv.put("gtin", gtin);
        cv.put("scanned_at", scannedAt);
        return db.insert("scan_items", null, cv);
    }

    /**
     * FAST ürün kataloğu satırı ekler/günceller.
     */
    public void upsertProductLocal(String gtin, String brandName) {
        if (gtin == null || gtin.isEmpty()) return;
        SQLiteDatabase db = getWritableDatabase();
        ContentValues cv = new ContentValues();
        cv.put("gtin", gtin);
        cv.put("brand_name", brandName);
        db.insertWithOnConflict("products_local", null, cv, SQLiteDatabase.CONFLICT_REPLACE);
    }

    /**
     * EASY satış başlığını ekler.
     *
     * @return insert edilen easy_sales.id (veya -1 hata)
     */
    public long insertEasySale(
            String createdAt,
            @Nullable String patient,
            @Nullable String citizenId,
            @Nullable String prescriptionNumber,
            @Nullable String note,
            @Nullable String deviceId
    ) {
        SQLiteDatabase db = getWritableDatabase();
        ContentValues cv = new ContentValues();
        cv.put("created_at", createdAt);
        cv.put("patient", patient);
        cv.put("citizen_id", citizenId);
        cv.put("prescription_number", prescriptionNumber);
        cv.put("note", note);
        cv.put("device_id", deviceId);
        return db.insert("easy_sales", null, cv);
    }

    /**
     * EASY satış kalemlerini ekler.
     *
     * Şimdilik sadece barkodları kaydediyoruz; brand/sn/status gibi alanlar
     * plugin tarafında doldurulabilir.
     *
     * @param saleId   easy_sales.id
     * @param barcodes Satışa ait karekod listesi
     */
    public void insertEasySaleItems(long saleId, List<String> barcodes) {
        if (saleId <= 0 || barcodes == null || barcodes.isEmpty()) return;

        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            for (String code : barcodes) {
                if (code == null || code.isEmpty()) continue;

                ContentValues cv = new ContentValues();
                cv.put("sale_id", saleId);
                cv.put("barcode", code);
                db.insert("easy_sale_items", null, cv);
            }
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    /**
     * Bir sayım oturumunu ve ona bağlı tüm barkod kayıtlarını siler.
     *
     * @param sessionId silinecek oturumun ID'si
     * @return silinen session satır sayısı (0 veya 1)
     */
    public int deleteSession(long sessionId) {
        SQLiteDatabase db = getWritableDatabase();
        // Önce bu oturuma ait barkod satırlarını sil
        db.delete("scan_items", "session_id = ?", new String[]{ String.valueOf(sessionId) });
        // Sonra oturum kaydını sil
        return db.delete("scan_sessions", "id = ?", new String[]{ String.valueOf(sessionId) });
    }

    /**
     * Oturum sayısını döndürür (debug / istatistik amaçlı).
     */
    public int getSessionCount() {
        SQLiteDatabase db = getReadableDatabase();
        Cursor c = db.rawQuery("SELECT COUNT(*) FROM scan_sessions", null);
        try {
            if (c.moveToFirst()) {
                return c.getInt(0);
            }
            return 0;
        } finally {
            c.close();
        }
    }

    /**
     * FAST sayım için eski API:
     * Bir oturuma ait tüm kodları tek seferde ekler.
     * FastMultiScanActivity db.insertItems(sessionId, codes, createdAt) çağırıyor.
     */
    public void insertItems(long sessionId, List<String> codes, String createdAt) {
        if (sessionId <= 0 || codes == null || codes.isEmpty()) return;

        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            for (String code : codes) {
                if (code == null || code.isEmpty()) continue;

                String gtin = extractGtinFromCode(code);

                ContentValues cv = new ContentValues();
                cv.put("session_id", sessionId);
                cv.put("code", code);
                cv.put("gtin", gtin);
                cv.put("scanned_at", createdAt);

                db.insert("scan_items", null, cv);
            }
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }
}
