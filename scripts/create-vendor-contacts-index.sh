#!/usr/bin/env bash
# Create the collection-group index for vendorContacts.vendorEmail.
#
# This index is REQUIRED by the autoLinkVendorContactsV2 Cloud Function,
# which runs:
#   db.collectionGroup('vendorContacts').where('vendorEmail', '==', ...).get()
#
# Without this index the function returns 500 INTERNAL with:
#   "The query requires a COLLECTION_GROUP_ASC index for collection
#    vendorContacts and field vendorEmail"
#
# The standard `firebase deploy --only firestore:indexes` cannot create
# this index because Firestore's CLI refuses with "this index is not
# necessary, configure using single field index controls". Single-field
# collection-group indexes must be created via the fieldOverride REST API
# (which is what the Firebase Console does under the hood).
#
# Requires:
#   - A service account JSON key at $SA_PATH (defaults to the one in
#     ~/Downloads)
#   - gcloud auth set to use that service account, OR
#   - GOOGLE_APPLICATION_CREDENTIALS pointing at it
#
# Run from the project root:
#   ./scripts/create-vendor-contacts-index.sh
set -euo pipefail

SA_PATH="${SA_PATH:-/Users/roger/Downloads/savetheday-2377a-firebase-adminsdk-fbsvc-fa7e0b76db.json}"
PROJECT_ID="savetheday-2377a"
COLLECTION_GROUP="vendorContacts"
FIELD_PATH="vendorEmail"

if [ ! -f "$SA_PATH" ]; then
  echo "❌ Service account not found at $SA_PATH"
  echo "   Set SA_PATH=/path/to/sa.json before running."
  exit 1
fi

export GOOGLE_APPLICATION_CREDENTIALS="$SA_PATH"
ACCESS_TOKEN=$(gcloud --project "$PROJECT_ID" auth print-access-token 2>/dev/null)
if [ -z "$ACCESS_TOKEN" ]; then
  echo "❌ Could not get access token. Run:"
  echo "   gcloud auth activate-service-account --key-file=$SA_PATH"
  exit 1
fi

FIELD_URL="https://firestore.googleapis.com/v1/projects/$PROJECT_ID/databases/(default)/collectionGroups/$COLLECTION_GROUP/fields/$FIELD_PATH"

echo "==> Checking current state of $COLLECTION_GROUP/$FIELD_PATH..."
CURRENT_STATE=$(curl -s "$FIELD_URL" -H "Authorization: Bearer $ACCESS_TOKEN" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    indexes = d.get('indexConfig', {}).get('indexes', [])
    if indexes:
        print(indexes[0].get('state', 'UNKNOWN'))
    else:
        print('NOT_SET')
except:
    print('PARSE_ERROR')
")
echo "  Current state: $CURRENT_STATE"

if [ "$CURRENT_STATE" = "READY" ]; then
  echo "  ✅ Index already READY — nothing to do."
  exit 0
fi

echo ""
echo "==> Creating collection-group index on $COLLECTION_GROUP.$FIELD_PATH..."
PATCH_RESULT=$(curl -s -X PATCH "$FIELD_URL" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"indexConfig\": {
      \"indexes\": [
        {
          \"queryScope\": \"COLLECTION_GROUP\",
          \"fields\": [
            {\"fieldPath\": \"$FIELD_PATH\", \"order\": \"ASCENDING\"}
          ]
        }
      ]
    }
  }")

NEW_STATE=$(echo "$PATCH_RESULT" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    if 'error' in d:
        print('ERROR:' + d['error'].get('message', 'unknown'))
    else:
        indexes = d.get('indexConfig', {}).get('indexes', [])
        if indexes:
            print(indexes[0].get('state', 'UNKNOWN'))
        else:
            print('UNKNOWN')
except Exception as e:
    print('PARSE_ERROR:' + str(e))
")
echo "  New state: $NEW_STATE"

if [ "$NEW_STATE" = "ERROR:"* ]; then
  echo "  ❌ Failed to create index: $NEW_STATE"
  exit 1
fi

if [ "$NEW_STATE" = "READY" ]; then
  echo "  ✅ Index is READY (was already built before this run)."
  exit 0
fi

echo ""
echo "==> Waiting for index to build..."
for i in $(seq 1 20); do
  sleep 10
  STATE=$(curl -s "$FIELD_URL" -H "Authorization: Bearer $ACCESS_TOKEN" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    indexes = d.get('indexConfig', {}).get('indexes', [])
    if indexes:
        print(indexes[0].get('state', 'UNKNOWN'))
    else:
        print('UNKNOWN')
except:
    print('PARSE_ERROR')
")
  echo "  Check $i: state=$STATE"
  if [ "$STATE" = "READY" ]; then
    echo ""
    echo "  ✅ Index is READY. autoLinkVendorContactsV2 should now work."
    exit 0
  fi
done

echo ""
echo "  ⚠️  Index still building after 200s. Check the Firebase Console:"
echo "     https://console.firebase.google.com/project/$PROJECT_ID/firestore/indexes"
exit 1
