DISRUPTIONIQ FINAL EXPANDED SYNTHETIC DATASET - 12 SCENARIOS
Generated: 2026-10-30. Fictional data for PS1 development, testing and ML experimentation.

SCALE
- Risk training rows: 30,000
- Orders: 30,000
- Order items: 75,193
- Suppliers: 120
- Warehouses: 20
- Products: 500
- Inventory rows: 10,000
- Shipments: 8,000
- Shipment items: 15,992
- Carrier webhook events: 2,001
- Scenarios/disruptions: 12
- Disruption-order impact links: 3,400

12 SCENARIOS
01 Supplier shipment delay
02 Warehouse inventory shortage
03 Carrier route disruption
04 Customs clearance hold
05 Quality inspection hold / quarantined batch
06 Demand spike
07 Warehouse capacity outage
08 Weather-related transport delay
09 Fuel price surge
10 Port congestion
11 Supplier production shutdown
12 Cold-chain temperature excursion

FILES (17 CSV + README)
suppliers.csv, warehouses.csv, products.csv, inventory.csv, orders.csv, order_items.csv,
shipments.csv, shipment_items.csv, carrier_webhook_events.csv, scenarios.csv, disruptions.csv,
disruption_order_impact.csv, order_risk_training.csv, recovery_options.csv, users_roles.csv,
approval_queue.csv, audit_trail.csv.

RELATIONSHIPS
suppliers.supplier_id -> shipments.supplier_id
warehouses.warehouse_id -> shipments.warehouse_id, orders.warehouse_id, inventory.warehouse_id
products.product_id -> inventory.product_id, order_items.product_id, shipment_items.product_id
orders.order_id -> order_items.order_id, disruption_order_impact.order_id
shipments.shipment_id -> shipment_items.shipment_id, carrier_webhook_events.shipment_id
scenarios.scenario_id -> disruptions.scenario_id
disruptions.disruption_id -> disruption_order_impact.disruption_id, recovery_options.disruption_id
recovery_options.recovery_id -> approval_queue.recovery_id

ML NOTES
order_risk_training.csv contains 30,000 order-level rows. Classification target: risk_level.
Regression target: risk_score. Do not include risk_score as an input when predicting risk_level.
Exclude order_id and any post-outcome fields. Use train/test split before preprocessing,
stratified split for classification, and report accuracy, macro-F1, per-class precision/recall,
confusion matrix and calibration. Consider class weights if classes are imbalanced.

HONESTY / VALIDITY
All records and labels are synthetic. The target is generated from a rule-based risk formula with
random variation. This supports pipeline development and controlled demonstrations; it does not
guarantee 88% accuracy or prove real-world predictive performance. High test accuracy can reflect
learning the synthetic label-generation process. Validate on historical labelled outcomes before
making operational claims.

BACKEND SAFETY
Inventory, quality holds, capacity, deadlines, approvals and separation-of-duties must be deterministic
backend rules. AI can summarise and suggest options, not authorize execution. Revalidate live state
immediately before execution. Enforce UNIQUE(idempotency_key) to safely ignore duplicate webhooks.
