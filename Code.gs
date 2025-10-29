/**
 * @OnlyCurrentDoc
 */

// --- پیکربندی اولیه ---
const STORE_URL = 'https://topnewstore.ir';
const CONSUMER_KEY = 'ck_083d217ea14ffb7163f377ce3b18b0a9bb6ce452';
const CONSUMER_SECRET = 'cs_0187197b555ad0b43c2f39629c806c711adc53bd';
const DEFAULT_CATEGORY_ID = 9; // دسته‌بندی پیش‌فرض
const BATCH_SIZE = 100; // تعداد محصول برای پردازش در هر درخواست دسته‌ای

/**
 * تابع اصلی برای افزودن منوی سفارشی به گوگل شیت.
 */
function onOpen() {
  SpreadsheetApp.getUi()
      .createMenu('ووکامرس')
      .addItem('همگام‌سازی محصولات', 'syncProducts')
      .addToUi();
}

/**
 * دسته‌بندی‌های جدید را به صورت دسته‌ای در ووکامرس ایجاد می‌کند.
 * @param {Array<Object>} categories - آرایه‌ای از اشیاء دسته‌بندی برای ایجاد.
 * @param {Map<string, number>} categoryMap - نقشه‌ی دسته‌بندی برای به‌روزرسانی با دسته‌بندی‌های جدید.
 */
function createCategories(categories, categoryMap) {
  const apiUrl = `${STORE_URL}/wp-json/wc/v3/products/categories/batch`;
  const authParams = `consumer_key=${CONSUMER_KEY}&consumer_secret=${CONSUMER_SECRET}`;

  const payload = {
    create: categories
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(apiUrl + '?' + authParams, options);
    const result = JSON.parse(response.getContentText());

    if (result.create && result.create.length > 0) {
      result.create.forEach(category => {
        if (category.id) {
          categoryMap.set(category.name.toLowerCase(), category.id);
          Logger.log(`دسته بندی جدید ایجاد شد: ${category.name} (ID: ${category.id})`);
        }
      });
    }
  } catch (e) {
    Logger.log(`خطا در ایجاد دسته‌بندی‌ها: ${e.toString()}`);
  }
}

/**
 * وظیفه اصلی این تابع، خواندن داده‌ها از شیت و آماده‌سازی آن‌ها برای پردازش دسته‌ای است.
 */
/**
 * تمام دسته‌بندی‌های محصول موجود در ووکامرس را دریافت کرده و یک نقشه از نام به ID آن‌ها ایجاد می‌کند.
 * @returns {Map<string, number>} یک نقشه از نام دسته‌بندی به ID.
 */
function getCategoryMap() {
  const categoryMap = new Map();
  let page = 1;
  let allCategories = [];

  const apiUrl = `${STORE_URL}/wp-json/wc/v3/products/categories`;
  const authParams = `consumer_key=${CONSUMER_KEY}&consumer_secret=${CONSUMER_SECRET}`;

  try {
    while (true) {
      const response = UrlFetchApp.fetch(`${apiUrl}?${authParams}&per_page=100&page=${page}`);
      const categories = JSON.parse(response.getContentText());

      if (categories.length === 0) {
        break;
      }

      allCategories = allCategories.concat(categories);
      page++;
    }

    allCategories.forEach(category => {
      categoryMap.set(category.name.toLowerCase(), category.id);
    });

  } catch (e) {
    Logger.log(`خطا در دریافت دسته‌بندی‌ها: ${e.toString()}`);
    SpreadsheetApp.getUi().alert('خطا در ارتباط با ووکامرس برای دریافت دسته‌بندی‌ها. لطفاً لاگ‌ها را بررسی کنید.');
  }

  return categoryMap;
}

function syncProducts() {
  const categoryMap = getCategoryMap();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const data = sheet.getDataRange().getValues();
  const headers = data.shift();

  const headerMap = {};
  headers.forEach((header, index) => {
    headerMap[header.trim()] = index;
  });

  const requiredHeaders = ['name_product', 'product_id'];
  for (const header of requiredHeaders) {
    if (!(header in headerMap)) {
      SpreadsheetApp.getUi().alert(`ستون ضروری "${header}" در شیت شما یافت نشد.`);
      return;
    }
  }

  const productsToProcess = [];
  const allSheetCategories = new Set();

  // تمام دسته‌بندی‌های استفاده شده در شیت را جمع‌آوری کن
  if ('product_cat' in headerMap) {
    data.forEach(row => {
      const categoryName = row[headerMap['product_cat']];
      if (categoryName && typeof categoryName === 'string') {
        allSheetCategories.add(categoryName.trim());
      }
    });
  }

  // دسته‌بندی‌های جدید را شناسایی و ایجاد کن
  const newCategoriesToCreate = [];
  allSheetCategories.forEach(catName => {
    if (catName && !categoryMap.has(catName.toLowerCase())) {
      newCategoriesToCreate.push({ name: catName });
    }
  });

  if (newCategoriesToCreate.length > 0) {
    createCategories(newCategoriesToCreate, categoryMap);
  }

  data.forEach(row => {
    const productName = row[headerMap['name_product']];
    const sku = row[headerMap['product_id']];

    if (!productName || !sku) return;

    const product = {
      name: productName,
      sku: sku.toString(),
      regular_price: row[headerMap['price']] ? row[headerMap['price']].toString() : '0',
      categories: [],
      images: [],
      status: 'publish' // وضعیت پیش‌فرض محصول
    };

    // پردازش وضعیت انتشار (visible)
    if ('visible' in headerMap) {
      const visibility = row[headerMap['visible']];
      // با تبدیل به عدد، هر دو حالت ورودی 0 و '0' به درستی کار می‌کنند.
      if (Number(visibility) === 0) {
        product.status = 'draft';
      }
    }

    // پردازش توضیحات محصول
    if ('description' in headerMap) {
      product.description = row[headerMap['description']];
    }

    // اختصاص دسته‌بندی
    const categoryName = ('product_cat' in headerMap) ? row[headerMap['product_cat']] : null;
    if (categoryName && categoryMap.has(categoryName.trim().toLowerCase())) {
      product.categories.push({ id: categoryMap.get(categoryName.trim().toLowerCase()) });
    } else {
      product.categories.push({ id: DEFAULT_CATEGORY_ID });
    }

    // پردازش وضعیت موجودی
    const stockStatusValue = row[headerMap['exist']];
    if (stockStatusValue !== undefined && stockStatusValue !== '') {
      const numericValue = Number(stockStatusValue);

      if (!isNaN(numericValue)) { // اگر مقدار عددی است یا می‌تواند به عدد تبدیل شود
        if (numericValue > 0) {
          product.manage_stock = true;
          product.stock_quantity = numericValue;
          product.stock_status = 'instock';
        } else { // اگر مقدار 0 است
          product.manage_stock = false;
          product.stock_status = 'outofstock';
        }
      } else if (stockStatusValue === 'موجود') {
        product.manage_stock = false;
        product.stock_status = 'instock';
      } else if (stockStatusValue === 'ناموجود') {
        product.manage_stock = false;
        product.stock_status = 'outofstock';
      }
    }

    const imageUrl = row[headerMap['link_pic']];
    if (imageUrl) {
      product.images.push({ src: imageUrl });
    }

    // پردازش گالری تصاویر محصول
    if ('gallery_pic' in headerMap) {
      const galleryUrls = row[headerMap['gallery_pic']];
      if (galleryUrls && typeof galleryUrls === 'string') {
        const urls = galleryUrls.split(',').map(url => url.trim()).filter(url => url);
        urls.forEach(url => {
          product.images.push({ src: url });
        });
      }
    }

    productsToProcess.push(product);
  });

  if (productsToProcess.length > 0) {
    batchCreateOrUpdateProducts(productsToProcess);
  }

  SpreadsheetApp.getUi().alert('همگام‌سازی محصولات با ووکامرس به پایان رسید.');
}

/**
 * محصولات را به صورت دسته‌ای (batch) در ووکامرس ایجاد یا به‌روزرسانی می‌کند.
 * @param {Array<Object>} products - آرایه‌ای از محصولات برای پردازش.
 */
function batchCreateOrUpdateProducts(products) {
  const apiUrl = `${STORE_URL}/wp-json/wc/v3/products`;
  const authParams = `consumer_key=${CONSUMER_KEY}&consumer_secret=${CONSUMER_SECRET}`;

  // 1. تمام SKUها را استخراج کن
  const skus = products.map(p => p.sku);

  // 2. محصولات موجود در ووکامرس را بر اساس SKUها پیدا کن
  const existingProductsMap = new Map();
  for (let i = 0; i < skus.length; i += BATCH_SIZE) {
    const skuBatch = skus.slice(i, i + BATCH_SIZE);
    try {
      const searchResponse = UrlFetchApp.fetch(`${apiUrl}?sku=${skuBatch.join(',')}&${authParams}&per_page=${BATCH_SIZE}`);
      const existingProducts = JSON.parse(searchResponse.getContentText());
      existingProducts.forEach(p => existingProductsMap.set(p.sku.toString(), p.id));
    } catch (e) {
      Logger.log(`خطا در یافتن محصولات موجود برای SKUها: ${skuBatch.join(',')}. خطا: ${e.toString()}`);
    }
  }

  // 3. محصولات را به دو لیست "ایجاد" و "به‌روزرسانی" تقسیم کن
  const batchPayload = { create: [], update: [] };
  products.forEach(product => {
    if (existingProductsMap.has(product.sku)) {
      product.id = existingProductsMap.get(product.sku);
      batchPayload.update.push(product);
    } else {
      batchPayload.create.push(product);
    }
  });

  // 4. درخواست‌های دسته‌ای را در بسته‌های کوچک‌تر ارسال کن
  const allChanges = [...batchPayload.create, ...batchPayload.update];
  for (let i = 0; i < allChanges.length; i += BATCH_SIZE) {
      const chunk = allChanges.slice(i, i + BATCH_SIZE);
      const finalPayload = {
          create: chunk.filter(p => !p.id),
          update: chunk.filter(p => p.id)
      };

      if (finalPayload.create.length === 0 && finalPayload.update.length === 0) continue;

      const options = {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(finalPayload),
        muteHttpExceptions: true
      };

      try {
        const response = UrlFetchApp.fetch(`${apiUrl}/batch?${authParams}`, options);
        const responseCode = response.getResponseCode();
        const responseBody = response.getContentText();
        if (responseCode >= 200 && responseCode < 300) {
          Logger.log(`بسته‌ای شامل ${chunk.length} محصول با موفقیت پردازش شد.`);
        } else {
          Logger.log(`خطا در پردازش بسته. کد پاسخ: ${responseCode}. متن پاسخ: ${responseBody}`);
        }
      } catch (e) {
        Logger.log(`ارسال درخواست دسته‌ای با خطا مواجه شد. خطا: ${e.toString()}`);
      }
  }
}
