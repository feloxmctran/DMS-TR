// src/plugins/fastStockScanner.ts
import { registerPlugin } from "@capacitor/core";

export interface StartMultiScanResult {
  barcodes: string[];
}

export interface ScanSession {
  id: number;
  created_at: string;
  note?: string | null;
  total_count: number;
  device_id?: string | null;
}

// Ürün kataloğu için satır tipi
export interface ProductRow {
  gtin: string;
  brand_name: string;
}

// initial import sonucu
export interface ImportInitialProductsResult {
  success: boolean;
  count: number;
}

// SYNC sonucu (Java: { added, updated })
export interface SyncProductsResult {
  added: number;
  updated: number;
}

// Stok raporu satırı
export interface StockReportRow {
  gtin: string | null;
  brand_name: string | null;
  distinctCount: number; // benzersiz kutu sayısı (COUNT DISTINCT code)
  totalScans: number; // toplam tarama sayısı
}

// Stok raporu sonucu
export interface GetStockReportResult {
  items: StockReportRow[];
  totalDistinct: number;
  totalScans: number;
  duplicateCount: number;
}

// Plugin interface
export interface FastStockScannerPlugin {
  startMultiScan(options: {
    durationMs?: number;
    skipNote?: boolean;
  }): Promise<StartMultiScanResult>;

  getScanSessions(): Promise<{ sessions: ScanSession[] }>;

  // Java: { deleted: number }
  deleteScanSession(options: { id: number }): Promise<{ deleted: number }>;

  // initial ürün import metodu
  importInitialProducts(options: {
    items: ProductRow[];
  }): Promise<ImportInitialProductsResult>;

  // SYNC (UPSERT)
  syncProducts(options: { items: ProductRow[] }): Promise<SyncProductsResult>;

  // stok raporu metodu
  getStockReport(options: {
    sessionIds: number[];
  }): Promise<GetStockReportResult>;
}

// DİKKAT: Java tarafındaki plugin adıyla birebir aynı olmalı
export const FastStockScanner = registerPlugin<FastStockScannerPlugin>(
  "FastStockScannerPlugin"
);
