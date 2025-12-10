// src/i18n.ts
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

const resources = {
  en: {
    translation: {
      app: { name: "DataMatrix Scanner" },

      buttons: {
        scan: "Scan & Check",
        manual: "Manual Input",
        products: "Products",
        receive: "Receive",
        stock: "Stock Count",
        settings: "Settings",
        back: "Back",
        anonQuery: "Query (no token)"
      },

      manual: {
        title: "Manual QR / GS1",
        placeholder: "Paste raw QR/GS1 text (e.g. starts with 010...)"
      },

      settings: {
        title: "Settings",
        testEnv: "Use TEST environment (testndbapi)",
        language: "Language"
      },

      result: {
        loading: "Loading…",
        errorTitle: "Error",
        empty: "No result yet. Scan a code or run a manual query.",
        cards: {
          result: "Result",
          history: "Movement History",
          detail: "Detail"
        },
        fields: {
          productName: "Product Name",
          gtin: "GTIN",
          serialNumber: "Serial Number",
          batchNumber: "Batch / LOT",
          productionDate: "Production Date",
          expirationDate: "Expiration Date",
          stakeHolderName: "Stakeholder",
          isAvailableForSale: "Available for Sale",
          isSuspendedOrRecalled: "Suspended / Recalled",
          manufacturerName: "Manufacturer",
          certificateNumber: "Certificate No",
          overallRetailPrice: "Overall Retail Price",
          isExpired: "Expired",
          productStatus: "Product Status",
          productState: "Product State",
          suspendRecallInfo: "Suspend / Recall Info",
          isFomsDrug: "FOMS Drug"
        },
        history: {
          headers: {
            declarationNumber: "Declaration No",
            stakeHolder: "Stakeholder",
            state: "State",
            stateDate: "State Date",
            price: "Price"
          }
        }
      },

      // === RECEIVE EKRANI METİNLERİ (EN) ===
      receive: {
        datamatrixLabel: "Datamatrix (manual)",
        cardTitle: "Result",
        sender: "Sender",
        to: "To",
        totalCount: "Total Count",
        transferOk: "Transfer OK",
        transferMismatch: "Transfer mismatch"
      }
    }
  },

  ru: {
    translation: {
      app: { name: "Сканер DataMatrix" },

      buttons: {
        scan: "Сканировать",
        manual: "Ввод вручную",
        products: "Продукция",
        receive: "Приёмка",
        stock: "Инвентаризация",
        settings: "Настройки",
        back: "Назад",
        anonQuery: "Запрос (без токена)"
      },

      manual: {
        title: "QR / GS1 вручную",
        placeholder: "Вставьте сырой текст QR/GS1 (например начинается с 010...)"
      },

      settings: {
        title: "Настройки",
        testEnv: "Использовать TEST (testndbapi)",
        language: "Язык"
      },

      result: {
        loading: "Загрузка…",
        errorTitle: "Ошибка",
        empty:
          "Пока нет результатов. Отсканируйте код или выполните ручной запрос.",
        cards: {
          result: "Результат",
          history: "История перемещений",
          detail: "Подробно"
        },
        fields: {
          productName: "Наименование",
          gtin: "GTIN",
          serialNumber: "Серийный номер",
          batchNumber: "Партия / LOT",
          productionDate: "Дата производства",
          expirationDate: "Срок годности",
          stakeHolderName: "Стейкхолдер",
          isAvailableForSale: "Доступно для продажи",
          isSuspendedOrRecalled: "Приостановлено / Отозвано",
          manufacturerName: "Производитель",
          certificateNumber: "№ сертификата",
          overallRetailPrice: "Розничная цена",
          isExpired: "Просрочено",
          productStatus: "Статус продукта",
          productState: "Состояние продукта",
          suspendRecallInfo: "Инфо о приост./отзыве",
          isFomsDrug: "Препарат ФОМС"
        },
        history: {
          headers: {
            declarationNumber: "№ декларации",
            stakeHolder: "Стейкхолдер",
            state: "Состояние",
            stateDate: "Дата",
            price: "Цена"
          }
        }
      },

      // === RECEIVE EKRANI METİNLERİ (RU) ===
      receive: {
        datamatrixLabel: "Datamatrix (вручную)",
        cardTitle: "Результат",
        sender: "Отправитель",
        to: "Получатель",
        totalCount: "Всего позиций",
        transferOk: "Трансфер ОК",
        transferMismatch: "Несоответствие трансфера"
      }
    }
  }
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: "en", // App ilk açılışta en; App.tsx içinden Preferences ile değiştiriyoruz
    fallbackLng: "en",
    interpolation: { escapeValue: false }
  });

export default i18n;
