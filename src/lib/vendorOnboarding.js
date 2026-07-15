// vendorOnboarding.js — client-side helper for the 5-step vendor wizard.
//
// Wraps the `applyAsVendor` Cloud Function callable. All field validation
// is also enforced server-side in functions/src/vendors.ts — we duplicate
// it here so the user gets fast feedback without a round-trip.
//
// Form shape matches ApplyAsVendorInput on the server. New fields added on
// the server need to be added here too; the server drops unknown keys.
//
// Why a helper and not inline in the screen:
// - Centralizes the form shape so all 5 step components can import from one
//   place (no copy-paste drift between Step2's submit and Step5's review).
// - Easier to unit-test the validation logic in isolation.
// - If we ever add a "draft" feature (save partial progress), it lives here.

import { functions } from './firebase';
import { httpsCallable } from 'firebase/functions';

/**
 * Vendor onboarding form state — single source of truth for the wizard.
 * Each step component receives `form` and an `update(patch)` callback.
 */
export const EMPTY_FORM = {
  // Step 1 — Account (mostly read from auth.currentUser)
  email: '',
  displayName: '',
  // Step 2 — Business
  name: '',
  category: '',       // top-level VENDOR_CATEGORIES key (e.g. 'photo_video')
  subcategory: '',    // sub-service key (e.g. 'photographer')
  description: '',
  yearsInBusiness: 1,
  serviceArea: '香港',
  // Step 3 — Pricing
  priceMin: 5000,
  priceMax: 15000,
  currency: 'HKD',
  openEnded: false,
  // Step 4 — Portfolio (array of uploaded CDN URLs)
  portfolio: [],
  tags: [],
  // Step 5 — T&C acceptance
  termsAccepted: false,
};

/**
 * Per-step validation. Returns { ok: true } or { ok: false, errors: { field: msg } }.
 * Used by the Next button on each step.
 */
export function validateStep(stepIndex, form) {
  const errors = {};

  if (stepIndex === 1) {
    // Account — no editable fields, just confirms the user is signed in.
    // The screen passes `form.email` already populated; nothing to check.
  }

  if (stepIndex === 2) {
    if (!form.name || form.name.trim().length < 2) {
      errors.name = '請填寫商戶名稱（至少 2 個字）';
    }
    if (form.name && form.name.length > 60) {
      errors.name = '商戶名稱太長（上限 60 字）';
    }
    if (!form.category) {
      errors.category = '請選擇服務分類';
    }
    if (form.category && !form.subcategory) {
      errors.subcategory = '請選擇子分類';
    }
    if (form.description && form.description.length > 500) {
      errors.description = '簡介太長（上限 500 字）';
    }
    if (form.yearsInBusiness !== undefined) {
      const y = Number(form.yearsInBusiness);
      if (Number.isNaN(y) || y < 0 || y > 100) {
        errors.yearsInBusiness = '年資必須是 0-100 之間';
      }
    }
  }

  if (stepIndex === 3) {
    const min = Number(form.priceMin);
    if (Number.isNaN(min) || min < 0) {
      errors.priceMin = '起步價必須是非負數字';
    }
    if (!form.openEnded) {
      const max = Number(form.priceMax);
      if (Number.isNaN(max) || max <= 0) {
        errors.priceMax = '請輸入最高價，或剔選「無上限」';
      } else if (max < min) {
        errors.priceMax = '最高價不能低於起步價';
      }
    }
    if (!form.currency) {
      errors.currency = '請選擇貨幣';
    }
  }

  if (stepIndex === 4) {
    if (!Array.isArray(form.portfolio) || form.portfolio.length < 1) {
      errors.portfolio = '請上傳至少 1 張作品圖片';
    }
    if (form.portfolio.length > 24) {
      errors.portfolio = '作品集最多 24 張';
    }
  }

  if (stepIndex === 5) {
    if (!form.termsAccepted) {
      errors.termsAccepted = '請確認同意條款';
    }
  }

  return Object.keys(errors).length === 0
    ? { ok: true }
    : { ok: false, errors };
}

/**
 * Submit the wizard. Server re-validates everything; client validation is
 * purely for fast feedback.
 *
 * @returns {Promise<{ ok: true, vendorUid, vendorId, status: 'pending' }>}
 */
export async function submitVendorApplication(form) {
  // Re-check everything before calling — saves a round-trip if the user
  // somehow got past the per-step Next button.
  for (let i = 1; i <= 5; i += 1) {
    const r = validateStep(i, form);
    if (!r.ok) {
      const err = new Error('表單資料不完整');
      err.code = 'validation';
      err.stepErrors = r.errors;
      throw err;
    }
  }

  const fn = httpsCallable(functions, 'applyAsVendor');
  const payload = {
    name: form.name.trim(),
    category: form.category,
    subcategory: form.subcategory,
    description: (form.description || '').trim(),
    yearsInBusiness: Number(form.yearsInBusiness) || 0,
    serviceArea: form.serviceArea || '香港',
    priceMin: Number(form.priceMin),
    priceMax: form.openEnded ? null : Number(form.priceMax),
    currency: form.currency,
    openEnded: Boolean(form.openEnded),
    portfolio: form.portfolio,
    tags: (form.tags || []).slice(0, 10),
  };
  const result = await fn(payload);
  return result.data;
}

/**
 * Helper: pre-fill the form from a Firebase Auth user. Called when Step1
 * mounts so the user sees their email and displayName.
 *
 * Also pre-fills `name` (the actual business name written to Firestore)
 * from `user.displayName` so users who signed up via VendorSignupCard
 * don't have to retype their business name in Step 2. The user can
 * still edit both fields independently if they want a different name
 * in each context.
 */
export function formFromUser(user) {
  if (!user) return EMPTY_FORM;
  const displayName = user.displayName || '';
  return {
    ...EMPTY_FORM,
    email: user.email || '',
    displayName,
    // 2026-07-14 — pre-fill name from displayName. Only do this when
    // name is currently empty (don't overwrite a value the user has
    // already started editing).
    name: EMPTY_FORM.name || displayName,
  };
}