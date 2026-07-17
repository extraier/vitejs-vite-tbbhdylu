// Vendor Ratings — client-side wrapper for the submitRating, deleteMyRating
// and listVendorRatings Cloud Functions (functions/src/ratings.ts).
//
// Couples leave 1-5 star reviews from the directory page. The function
// validates auth, enforces that only couples can submit (not vendors
// or admins), validates review length, and atomically updates the
// vendor doc's `rating` + `ratingCount` aggregates.
//
// All functions are typed loosely — the runtime shape is verified
// inside the Cloud Function. If the function returns an error, we
// surface it to the caller via the shared toast system.

import {
  getFunctions,
  httpsCallable,
} from 'firebase/functions';

const functions = getFunctions();

let _submitRating = null;
let _deleteMyRating = null;
let _listVendorRatings = null;

function submitRatingFn() {
  if (!_submitRating) _submitRating = httpsCallable(functions, 'submitRating');
  return _submitRating;
}
function deleteMyRatingFn() {
  if (!_deleteMyRating) _deleteMyRating = httpsCallable(functions, 'deleteMyRating');
  return _deleteMyRating;
}
function listVendorRatingsFn() {
  if (!_listVendorRatings)
    _listVendorRatings = httpsCallable(functions, 'listVendorRatings');
  return _listVendorRatings;
}

export async function submitVendorRating({
  vendorId,
  rating,
  review,
  weddingYear,
  coupleName,
}) {
  return submitRatingFn()({
    vendorId,
    rating,
    review: review || '',
    weddingYear: weddingYear || null,
    coupleName: coupleName || '',
  }).then((r) => r.data);
}

export async function deleteMyVendorRating(vendorId) {
  return deleteMyRatingFn()({ vendorId }).then((r) => r.data);
}

export async function listVendorRatings({
  vendorId,
  limit = 10,
  startAfterId = null,
}) {
  return listVendorRatingsFn()({ vendorId, limit, startAfterId }).then((r) => r.data);
}
