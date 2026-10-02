# Feature Implementation: Network Fee Chart, Leaderboard, Price Alerts, and CSV Notes

This PR implements four new features for Stellar-MicroPay:

## Changes

### Task #1196: Add network fee history sparkline chart
- **Backend**: Added `GET /api/network/fee-history` endpoint that returns p50 fee data for the last 24 hours with 10-minute caching
- **Frontend**: Created `FeeHistorySparkline.tsx` component using Recharts for sparkline visualization with tooltip
- **Integration**: Added sparkline chart to the network stats page near the P50 fee display

**Files modified:**
- `backend/src/routes/network.js` - New route file
- `backend/src/controllers/networkController.js` - New controller
- `backend/src/services/networkService.js` - Service with caching
- `backend/src/server.js` - Route registration
- `frontend/components/FeeHistorySparkline.tsx` - New component
- `frontend/pages/network.tsx` - Integration

### Task #1202: Add GET /api/tips/leaderboard endpoint
- **Backend**: Added global leaderboard endpoint returning top 10 recipients and senders
- **Data**: Returns `{ topRecipients, topSenders, totalTipped }` with address, federationName, totalXLM, and count
- **Caching**: Results cached for 10 minutes

**, "backend/src/routes/tips.js" - Added /leaderboard route**
- `backend/src/controllers/tipsController.js` - Added getGlobalLeaderboard controller
- `backend/src/services/tipsService.js` - Added aggregation logic

### Task #1199: Add price alert browser notification
- **Backend**: Added price alert API endpoints (`POST /api/price-alerts`, `GET /api/price-alerts`, `DELETE /api/price-alerts/:id`)
- **Service**: Price polling from CoinGecko every 5 minutes, triggers notifications when thresholds are crossed
- **Frontend**: Added price alert form in Settings page with asset, direction, and target price inputs
- **UI**: Displays active alerts with delete functionality and fallback banner for browsers without notification support

**Files modified:**
- `backend/src/routes/priceAlerts.js` - New route file
- `backend/src/controllers/priceAlertsController.js` - New controller
- `backend/src/services/priceAlertsService.js` - Service with CoinGecko integration
- `backend/src/server.js` - Route registration
- `frontend/pages/settings.tsx` - Price alert UI section

### Task #1198: Add payment notes to CSV export
- **CSV Export**: Extended `exportToCSV` function to include a "Note" column after "Transaction Hash"
- **LocalStorage**: Notes are fetched from localStorage by transaction hash
- **Privacy**: Added privacy note in the export UI indicating notes are browser-local

**Files modified:**
- `frontend/utils/format.ts` - Updated exportToCSV function
- `frontend/pages/dashboard.tsx` - Added privacy note to export UI

## Testing

- Network fee sparkline displays correctly with tooltip on hover
- Leaderboard endpoint returns top 10 recipients and senders with proper aggregation
- Price alerts can be created, displayed, and deleted; notifications trigger on threshold crossing
- CSV export includes notes column with data from localStorage
- Privacy note appears in export UI

## Checklist

- [x] Code follows project style guidelines
- [x] All tasks implemented according to acceptance criteria
- [x] No breaking changes to existing functionality
- [x] TypeScript lint errors noted (pre-existing, not related to new code)

---

close #1196
close #1202
close #1199
close #1198
