$ErrorActionPreference = "Stop"

Write-Host "=== Building the Quote Draft Agent (Step 2) local pricing engine ==="
Write-Host ""
Write-Host "This replaces the previous 'paste already-priced Step 2 output' flow."
Write-Host "The input box now accepts the Quote Request Agent (Step 1) output"
Write-Host "directly -- the same text FSTs post in Salesforce. EnQuote itself now"
Write-Host "does the matching, pricing, and tax-code assignment that the Step 2"
Write-Host "Copilot Studio agent used to do manually, using a real product catalog"
Write-Host "(198 items from On-Demand-Alavara-Tax-Codes.xlsx) embedded locally."
Write-Host ""
Write-Host "No API calls. No Base44 AI. No LLM invocation of any kind."
Write-Host ""

$destDir = ".\src\features\quoteDraftAgent"
New-Item -ItemType Directory -Force -Path $destDir | Out-Null

Write-Host "Writing productCatalog.js (198 catalog items with real prices and tax codes)..."
@'
export const PRODUCT_CATALOG = [
  { name: "60 Amp Brass 1-Time Fuse Cartridges (2-Pack)", category: "Breakers", unit_price: 8.55, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "FRN Series 40 Amp Brass Time-Delay Cartridge Fuses (2-Pack)", category: "Breakers", unit_price: 27.97, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "Square D HOM215 Homeline 15A 2-Pole 120/240V Circuit Breaker", category: "Breakers", unit_price: 18.24, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "BR 60 Amp 120/240 Volts 2-Pole Circuit Breaker", category: "Breakers", unit_price: 21.32, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "BR 40 Amp 120/240 Volts 2-Pole Circuit Breaker", category: "Breakers", unit_price: 21.32, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "BR 20 Amp 120/240 Volts 2-Pole Circuit Breaker", category: "Breakers", unit_price: 21.32, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "BR 50 Amp 120/240 Volts 2-Pole Circuit Breaker", category: "Breakers", unit_price: 21.32, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "BR 80 Amp 120/240 Volts 2-Pole Circuit Breaker", category: "Breakers", unit_price: 55.19, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "20Amp Eaton BR120", category: "Breakers", unit_price: 8.21, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "QD Sealing Cap (female) - 10 pack", category: "Conduit & Raceway", unit_price: 40.5, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "Field Wireable QD Connector (female) - 10 pack (Commercial)", category: "Conduit & Raceway", unit_price: 135.0, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "Field Wireable QD Connector (male) - 10 pack (Commercial)", category: "Conduit & Raceway", unit_price: 135.0, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "Enphase Field Wireable QD Connector (male) 1 pack (Commercial) (Engage Splice)", category: "Conduit & Raceway", unit_price: 13.5, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "Field Wireable QD Connector (female) 1 pack (Commercial) (Engage Splice)", category: "Conduit & Raceway", unit_price: 13.5, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "Halex 1/2 in. Liquid-Tight Connector", category: "Conduit & Raceway", unit_price: 7.25, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "Solar Panel Bird Wire 6 in. x 98 ft. Critter Guard Roll Kit Removable Steel Solar Panel Guard with Fasteners", category: "Critter Guard", unit_price: 41.75, unit: "each", tax_category: "SOLAR_ACCESSORY", tax_code: "TTR146718" },
  { name: "Critter Guard Fastener Clips 120Pcs Set", category: "Critter Guard", unit_price: 40.0, unit: "each", tax_category: "SOLAR_ACCESSORY", tax_code: "TTR146718" },
  { name: "Critter Guard Roll Kit 8 in. x 98 ft. Clips included", category: "Critter Guard", unit_price: 59.62, unit: "roll", tax_category: "SOLAR_ACCESSORY", tax_code: "TTR146718" },
  { name: "Critter Guard Roll Kit 6 in. x 98 ft. Clips included", category: "Critter Guard", unit_price: 44.17, unit: "roll", tax_category: "SOLAR_ACCESSORY", tax_code: "TTR146718" },
  { name: "11 inch Black UV-Rated Zip Ties", category: "Critter Guard", unit_price: 9.48, unit: "each", tax_category: "SOLAR_ACCESSORY", tax_code: "TTR146718" },
  { name: "Mid-Clamps - pack of 20 (approx. cost)", category: "Critter Guard", unit_price: 20.0, unit: "each", tax_category: "SOLAR_ACCESSORY", tax_code: "TTR146718" },
  { name: "Fastener Clips (50 Pack)", category: "Critter Guard", unit_price: 15.0, unit: "each", tax_category: "SOLAR_ACCESSORY", tax_code: "TTR146718" },
  { name: "BR 125 Amp 8-Space 16-Circuit Outdoor Main Lug Loadcenter with Cover", category: "Enclosure", unit_price: 74.45, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "60 Amp 120/240-Volt Fused Safety Switch", category: "Enclosure", unit_price: 221.46, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "60A Outdoor Rated Fused Disconnect", category: "Enclosure", unit_price: 33.65, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "QD Cable Terminator (10 Pack)", category: "Enphase Products", unit_price: 183.0, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "Engage Replacement Cable Adapter - Single Landscape Drop 1.7m (ETD With Field connectors Included)", category: "Enphase Products", unit_price: 47.3, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "Engage Replacement Cable Adapter - Single Portrait Drop 1m (ETD With Field connectors Included)", category: "Enphase Products", unit_price: 41.8, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "Engage Replacement Cable Adapter - Single (ETD With Field connectors Included)", category: "Enphase Products", unit_price: 290.0, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "Consumption Clamp Current Transformer (CT-200-CLAMP)", category: "Enphase Products", unit_price: 34.0, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "IQ Battery 3 Cover & Mounting Bracket", category: "Enphase Products", unit_price: 156.0, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "IQ Combiner 5 HDK", category: "Enphase Products", unit_price: 733.5, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "Replacement IQ Gateway PCB for IQ Combiner 4", category: "Enphase Products", unit_price: 419.5, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "PCT - Production Current Transformer (Meter)", category: "Enphase Products", unit_price: 30.84, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "IQ Field Wireable (socket) Ea. SKU: Q-CONN-10F", category: "Enphase Products", unit_price: 12.9, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "IQ Field Wireable (plug) Ea. SKU: Q-CONN-10M", category: "Enphase Products", unit_price: 12.9, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "IQ Battery 3 (R1)", category: "Enphase Products", unit_price: 1499.0, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "Enphase Control Cable 1 Foot", category: "Enphase Products", unit_price: 1.35, unit: "ft", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "CCT - Consumption Current Transformer (Meter)", category: "Enphase Products", unit_price: 56.54, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "IQ Cable (Q-12-RAW-300)", category: "Enphase Products", unit_price: 1.43, unit: "ft", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "IQ Field Wireable (socket) 10 pack SKU: Q-CONN-10F", category: "Enphase Products", unit_price: 129.0, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "IQ Field Wireable (plug) 10 pack SKU:Q-CONN-10M", category: "Enphase Products", unit_price: 129.0, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "IQ Load Controller", category: "Enphase Products", unit_price: 431.0, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "Enphase Connector Clip (pack of 12)", category: "Enphase Products", unit_price: 36.0, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "Engage Cable Clips (pack of 100)", category: "Enphase Products", unit_price: 44.0, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "IQ Terminator Cap - Single cap", category: "Enphase Products", unit_price: 18.3, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "IQ7PD-72 Microinverter", category: "Enphase Products", unit_price: 79.0, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "Mobile Connect CELLMODEM-07", category: "Enphase Products", unit_price: 499.0, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "IQ Cable Single Drop (portrait)", category: "Enphase Products", unit_price: 18.0, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "IQ Relay Kit", category: "Enphase Products", unit_price: 471.5, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "IQ Sealing Cap (Q-SEAL-10) (10pk)", category: "Enphase Products", unit_price: 33.5, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "IQ Field Wireable (socket/female) (single)", category: "Enphase Products", unit_price: 12.9, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "IQ Field Wireable (plug/male) (single)", category: "Enphase Products", unit_price: 12.9, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "Termination Cap (Q-TERM-10)", category: "Enphase Products", unit_price: 183.0, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "IQ Field Wireable (socket/female) 10-pack (Q-CONN-10F)", category: "Enphase Products", unit_price: 129.0, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "IQ Field Wireable (plug/male) 10-pack (Q-CONN-10M)", category: "Enphase Products", unit_price: 129.0, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "IQ-Cable per foot", category: "Enphase Products", unit_price: 1.46, unit: "ft", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "Enphase Q Cable Landscape (Q-12-17-240)", category: "Enphase Products", unit_price: 654.5, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "Enphase IQ Battery 5P", category: "Enphase Products", unit_price: 3640.25, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "Enphase Envoy Gateway", category: "Enphase Products", unit_price: 485.0, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "Enphase IQ Battery 10T", category: "Enphase Products", unit_price: 5097.0, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "Enphase IQ8+ Microinverter", category: "Enphase Products", unit_price: 171.0, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "Enphase IQ8M Microinverter", category: "Enphase Products", unit_price: 214.99, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "Enphase IQ8 Microinverter (60-cell)", category: "Enphase Products", unit_price: 177.14, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "Enphase DC Adapter Cable (EN4 to MC4)", category: "Enphase Products", unit_price: 93.15, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "Enphase Q Terminator Cap", category: "Enphase Products", unit_price: 5.5, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "Portrait IQ Cable Single drop (Q-12-10-240)", category: "Enphase Products", unit_price: 18.0, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "Enphase Consumption Current Transformers", category: "Enphase Products", unit_price: 51.4, unit: "pair", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "Enphase IQ EV Charger 2 (9.6 kW)", category: "Enphase Products", unit_price: 999.0, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "Enphase IQ Portable Panel", category: "Enphase Products", unit_price: 369.0, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "Enphase IQ PowerPack 1500", category: "Enphase Products", unit_price: 999.0, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "Landscape IQ Cable Single Drop (Q-12-17-240)", category: "Enphase Products", unit_price: 21.0, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "Enphase IQ EV Charger 2 (11.5 kW)", category: "Enphase Products", unit_price: 1124.0, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "Enphase Control Cable", category: "Enphase Products", unit_price: 2.79, unit: "foot", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "Enphase Solar Extension Cables (10m)", category: "Enphase Products", unit_price: 95.0, unit: "set", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "Enphase IQ Combiner 6C", category: "Enphase Products", unit_price: 1754.0, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "Eaton 30 Amp Non-Fusible Safety Switch (DG221URB)", category: "Junction Box", unit_price: 108.61, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "Soladeck-Type Roof Junction Boxes", category: "Junction Box", unit_price: 42.14, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "Cantex 6 in. x 6 in. x 4 in. Junction Box", category: "Junction Box", unit_price: 20.9, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "Liquid Tight Cord Grip (oval gland)", category: "Junction Box", unit_price: 2.11, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "4 in. x 4 in. x 2 in. Junction Box", category: "Junction Box", unit_price: 12.98, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "PVC Junction Box - 5 x 5 x 2 in", category: "Junction Box", unit_price: 17.2, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "6 in. x 6 in. x 4 in. Gray Electrical PVC Junction Box", category: "Junction Box", unit_price: 25.72, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "4 in. 30.3 CU. in. metallic square box", category: "Junction Box", unit_price: 3.98, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "PVC Junction Box (8x8x4)", category: "Junction Box", unit_price: 18.75, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "4x4 Metal Junction Box", category: "Junction Box", unit_price: 3.5, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "NEMA 3R Metal Enclosure (12x10x6)", category: "Junction Box", unit_price: 65.0, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "Cable Entry Gland (PG16)", category: "Junction Box", unit_price: 2.85, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "4x4 Metal Box Cover (Blank)", category: "Junction Box", unit_price: 0.95, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "PVC Junction Box (6x6x4)", category: "Junction Box", unit_price: 12.5, unit: "each", tax_category: "GENERAL_ELECTRICAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "Q.PEAK DUO BLK", category: "Microinverters", unit_price: 286.05, unit: "each", tax_category: "MICROINVERTER", tax_code: "TTR146714" },
  { name: "Enphase IQ8M Microinverter", category: "Microinverters", unit_price: 218.21, unit: "each", tax_category: "MICROINVERTER", tax_code: "TTR146714" },
  { name: "Enphase IQ8+ Microinverter", category: "Microinverters", unit_price: 189.0, unit: "each", tax_category: "MICROINVERTER", tax_code: "TTR146714" },
  { name: "Enphase IQ8A Microinverter", category: "Microinverters", unit_price: 221.78, unit: "each", tax_category: "MICROINVERTER", tax_code: "TTR146714" },
  { name: "Enphase M215 Microinverter", category: "Microinverters", unit_price: 181.0, unit: "each", tax_category: "MICROINVERTER", tax_code: "TTR146714" },
  { name: "Enphase IQ7A Microinverter", category: "Microinverters", unit_price: 192.0, unit: "each", tax_category: "MICROINVERTER", tax_code: "TTR146714" },
  { name: "Enphase IQ8X Microinverter", category: "Microinverters", unit_price: 228.5, unit: "each", tax_category: "MICROINVERTER", tax_code: "TTR146714" },
  { name: "Enphase IQ7+ Microinverter", category: "Microinverters", unit_price: 176.96, unit: "each", tax_category: "MICROINVERTER", tax_code: "TTR146714" },
  { name: "Enphase IQ8H-240 Microinverter", category: "Microinverters", unit_price: 245.88, unit: "each", tax_category: "MICROINVERTER", tax_code: "TTR146714" },
  { name: "8pcs SunPower 518636 End Clamp, Wedge, InvisiMount, Two Boxes", category: "Mounting / Racking", unit_price: 40.0, unit: "each", tax_category: "SOLAR_ACCESSORY", tax_code: "TTR146718" },
  { name: "Grounding Lug - Unirac Railing", category: "Mounting / Racking", unit_price: 10.0, unit: "each", tax_category: "SOLAR_ACCESSORY", tax_code: "TTR146718" },
  { name: "Unirac E-BOSS Conduit Mount 3.0 w/ Butyl Kit (1 pc)", category: "Mounting / Racking", unit_price: 7.28, unit: "each", tax_category: "SOLAR_ACCESSORY", tax_code: "TTR146718" },
  { name: "L-Foot Mounting Bracket (Universal)", category: "Mounting / Racking", unit_price: 8.5, unit: "each", tax_category: "SOLAR_ACCESSORY", tax_code: "TTR146718" },
  { name: "3/4 in. Aluminum Conduit Bender", category: "Rental Equipment", unit_price: 44.98, unit: "each", tax_category: "RENTAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "Pickup truck rental per day + gas", category: "Rental Equipment", unit_price: 107.5, unit: "day", tax_category: "RENTAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "Extension ladder - Rental cost per day", category: "Rental Equipment", unit_price: 72.5, unit: "day", tax_category: "RENTAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "Towable Boom Lift Rental - Texas", category: "Rental Equipment", unit_price: 600.0, unit: "day", tax_category: "RENTAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "Ladder rental", category: "Rental Equipment", unit_price: 150.0, unit: "day", tax_category: "RENTAL_EQUIPMENT", tax_code: "TTR152589" },
  { name: "thread sealant", category: "Roof Mounting & Sealing", unit_price: 6.48, unit: "each", tax_category: "SOLAR_ACCESSORY", tax_code: "TTR146718" },
  { name: "209XR Extreme Rubberized Wet Patch Black Roof Leak Repair Sealant Caulk", category: "Roof Mounting & Sealing", unit_price: 10.97, unit: "each", tax_category: "SOLAR_ACCESSORY", tax_code: "TTR146718" },
  { name: "IronRidge BX Mill Finish Bottom Clamp with Hardware", category: "Roof Mounting & Sealing", unit_price: 2.21, unit: "each", tax_category: "SOLAR_ACCESSORY", tax_code: "TTR146718" },
  { name: "IronRidge BX 35mm Mill Finish Top Clamp", category: "Roof Mounting & Sealing", unit_price: 1.55, unit: "each", tax_category: "SOLAR_ACCESSORY", tax_code: "TTR146718" },
  { name: "IronRidge Universal Mid Clamp, 30-45mm, w/ Bonding, Mill", category: "Roof Mounting & Sealing", unit_price: 4.89, unit: "each", tax_category: "SOLAR_ACCESSORY", tax_code: "TTR146718" },
  { name: "Scotch 3/4 in. x 25 ft. Extreme Weather Electrical Tape - Black", category: "Roof Mounting & Sealing", unit_price: 3.98, unit: "roll", tax_category: "SOLAR_ACCESSORY", tax_code: "TTR146718" },
  { name: "Frame Mount (40 mm) clip", category: "Roof Mounting & Sealing", unit_price: 4.1, unit: "each", tax_category: "SOLAR_ACCESSORY", tax_code: "TTR146718" },
  { name: "0.54 ft. Rooftop Support Block", category: "Roof Mounting & Sealing", unit_price: 12.93, unit: "each", tax_category: "SOLAR_ACCESSORY", tax_code: "TTR146718" },
  { name: "Duct Seal Putty", category: "Roof Mounting & Sealing", unit_price: 5.34, unit: "each", tax_category: "SOLAR_ACCESSORY", tax_code: "TTR146718" },
  { name: "Ironridge UFO-CL-01-B1, Module Clamps", category: "Roof Mounting & Sealing", unit_price: 3.78, unit: "each", tax_category: "SOLAR_ACCESSORY", tax_code: "TTR146718" },
  { name: "Dicor Self-Leveling Lap Sealant", category: "Roof Mounting & Sealing", unit_price: 9.5, unit: "each", tax_category: "SOLAR_ACCESSORY", tax_code: "TTR146718" },
  { name: "Butyl Tape Roll (1\"x50ft)", category: "Roof Mounting & Sealing", unit_price: 18.5, unit: "per roll", tax_category: "SOLAR_ACCESSORY", tax_code: "TTR146718" },
  { name: "Roof Flashing Boot (3/4\")", category: "Roof Mounting & Sealing", unit_price: 14.5, unit: "each", tax_category: "SOLAR_ACCESSORY", tax_code: "TTR146718" },
  { name: "Roof Flashing Boot (1/2\")", category: "Roof Mounting & Sealing", unit_price: 12.5, unit: "each", tax_category: "SOLAR_ACCESSORY", tax_code: "TTR146718" },
  { name: "Stainless Steel Lag Bolts (5/16\"x3\", 25pk)", category: "Roof Mounting & Sealing", unit_price: 15.5, unit: "per 25 pack", tax_category: "SOLAR_ACCESSORY", tax_code: "TTR146718" },
  { name: "Polyurethane Roof Sealant", category: "Roof Mounting & Sealing", unit_price: 8.75, unit: "each", tax_category: "SOLAR_ACCESSORY", tax_code: "TTR146718" },
  { name: "Through-Bolt Roof Mount Kit", category: "Roof Mounting & Sealing", unit_price: 42.0, unit: "per kit", tax_category: "SOLAR_ACCESSORY", tax_code: "TTR146718" },
  { name: "QuickBOLT Roof-Mounted Conduit Supports", category: "Roof Mounting & Sealing", unit_price: 79.25, unit: "each", tax_category: "SOLAR_ACCESSORY", tax_code: "TTR146718" },
  { name: "Tubes of Roof Mastic Caulk", category: "Roof Mounting & Sealing", unit_price: 7.5, unit: "each", tax_category: "SOLAR_ACCESSORY", tax_code: "TTR146718" },
  { name: "ATS Troubleshooting & Replacement", category: "Services", unit_price: 500.0, unit: "each", tax_category: "SERVICES", tax_code: "SS300220" },
  { name: "Utility Interconnection", category: "Services", unit_price: 500.0, unit: "each", tax_category: "SERVICES", tax_code: "SS300220" },
  { name: "AHJ Permitting", category: "Services", unit_price: 300.0, unit: "each", tax_category: "SERVICES", tax_code: "SS300220" },
  { name: "Load controller install/replace", category: "Services", unit_price: 0.0, unit: "each", tax_category: "SERVICES", tax_code: "SS300220" },
  { name: "Battery Installation", category: "Services", unit_price: 0.0, unit: "each", tax_category: "SERVICES", tax_code: "SS300220" },
  { name: "Array Mapping", category: "Services", unit_price: 0.0, unit: "each", tax_category: "SERVICES", tax_code: "SS300220" },
  { name: "Gateway install", category: "Services", unit_price: 0.0, unit: "each", tax_category: "SERVICES", tax_code: "SS300220" },
  { name: "Comprehensive Diagnostic (Troubleshooting)", category: "Services", unit_price: 450.0, unit: "each", tax_category: "SERVICES", tax_code: "SS300220" },
  { name: "Gateway Communication - Monitoring Troubleshoot or Replacement", category: "Services", unit_price: 450.0, unit: "each", tax_category: "SERVICES", tax_code: "SS300220" },
  { name: "Microinverter Replacement for RMA'ed 5 MI's and under", category: "Services", unit_price: 450.0, unit: "each", tax_category: "SERVICES", tax_code: "SS300220" },
  { name: "Alex Tech 25ft - 1/4 inch Split Wire Loom Tubing - Black", category: "Wiring & Cable Management", unit_price: 9.99, unit: "each", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "14 AWG White Stranded CU THHN Wire", category: "Wiring & Cable Management", unit_price: 1.2, unit: "ft", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "Wago 221-412 Wire Lever Nuts 2 Wire Conductor Compact Splicing Connectors", category: "Wiring & Cable Management", unit_price: 0.5, unit: "each", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "2 in. J Hook Cable Angle Bracket Support (50-Pack)", category: "Wiring & Cable Management", unit_price: 174.13, unit: "each", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "5-Terminal Ground Bar Kit - eaton", category: "Wiring & Cable Management", unit_price: 9.98, unit: "each", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "Butt Splice Crimp Connector 12-10 AWG Heat Shrink (5-Pack)", category: "Wiring & Cable Management", unit_price: 6.91, unit: "each", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "12-10 AWG Butt Splice Terminal with Heat Shrink Insulation (25-Pack)", category: "Wiring & Cable Management", unit_price: 11.88, unit: "each", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "14-4 AWG Copper Lay-In Lug Connector", category: "Wiring & Cable Management", unit_price: 12.58, unit: "each", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "Wing-Nut Wire Connector, 454 Blue, Bag of 25", category: "Wiring & Cable Management", unit_price: 13.98, unit: "each", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "50 ft. 8-Gauge Solid SD Bare Copper Grounding Wire", category: "Wiring & Cable Management", unit_price: 36.0, unit: "each", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "MC4 Cable Connectors with 6 each Male & Female - 12 pack 10AWG Solar Panel", category: "Wiring & Cable Management", unit_price: 35.98, unit: "each", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "4-14 AWG Bagged Insulated Tap Connector, Black", category: "Wiring & Cable Management", unit_price: 14.69, unit: "each", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "3/4 in. ACC Non-Metallic Strain Relief Cord Connector", category: "Wiring & Cable Management", unit_price: 3.29, unit: "each", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "Multi-Groove Fiberglass 100 ft. Fish Tape with Spiral Steel Leader", category: "Wiring & Cable Management", unit_price: 135.0, unit: "each", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "BR 15 Amp 120/240 Volts 2-Pole Circuit Breaker", category: "Wiring & Cable Management", unit_price: 21.32, unit: "each", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "10 White Stranded CU THHN Wire", category: "Wiring & Cable Management", unit_price: 1.05, unit: "ft", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "10 Black Stranded CU THHN Wire", category: "Wiring & Cable Management", unit_price: 1.05, unit: "ft", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "10 Green Stranded CU THHN Wire", category: "Wiring & Cable Management", unit_price: 1.05, unit: "ft", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "10 Red Stranded CU THHN Wire", category: "Wiring & Cable Management", unit_price: 0.8, unit: "ft", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "1 in. Non-Metallic Liquid-Tight Push-On Connector (each)", category: "Wiring & Cable Management", unit_price: 6.91, unit: "each", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "25 ft. #4-Gauge AWG Copper Wire", category: "Wiring & Cable Management", unit_price: 45.0, unit: "each", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "18 AWG, Black Wire, 100 ft.", category: "Wiring & Cable Management", unit_price: 0.29, unit: "ft", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "14 AWG Red Stranded Copper THHN Wire", category: "Wiring & Cable Management", unit_price: 1.2, unit: "ft", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "14 AWG Green Stranded Copper THHN Wire", category: "Wiring & Cable Management", unit_price: 1.2, unit: "ft", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "14 AWG Black Stranded Copper THHN Wire", category: "Wiring & Cable Management", unit_price: 1.2, unit: "ft", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "60 Amp 240-Volt 2-Pole Fused Outdoor General Duty Safety Switch", category: "Wiring & Cable Management", unit_price: 190.72, unit: "each", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "1/2\" Heat Shrink Tubing", category: "Wiring & Cable Management", unit_price: 2.99, unit: "each", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "3/8\" Heat Shrink Tubing", category: "Wiring & Cable Management", unit_price: 2.99, unit: "each", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "IQ Sealing Cap (Q-BA-CAP-10) Ea", category: "Wiring & Cable Management", unit_price: 3.35, unit: "each", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "3M Electrical Tape - 60 ft", category: "Wiring & Cable Management", unit_price: 2.98, unit: "each", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "1/4 in. Coaxial Cable Clamp RG-6 (20-Pack)", category: "Wiring & Cable Management", unit_price: 5.23, unit: "each", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "Water Proof/Weather Proof Wire Nuts - 15 pk", category: "Wiring & Cable Management", unit_price: 27.22, unit: "each", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "MC4 Connector (6-pack)", category: "Wiring & Cable Management", unit_price: 34.5, unit: "each", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "QD 12AWG Cable (Commercial) w/120 Male Connectors - 2.0m Max Module Pitch", category: "Wiring & Cable Management", unit_price: 203.5, unit: "each", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "3/4 in. Electrical Metallic Tube (EMT) Set-Screw Connectors (5-Pack)", category: "Wiring & Cable Management", unit_price: 5.45, unit: "each", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "1 in. Insulated Grounding Bushing", category: "Wiring & Cable Management", unit_price: 13.52, unit: "each", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "IronRidge XR-LUG-04-A1 Grounding Lug", category: "Wiring & Cable Management", unit_price: 7.03, unit: "each", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "6-Gauge Solid SD Bare Copper Grounding Wire", category: "Wiring & Cable Management", unit_price: 1.63, unit: "ft", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "Polaris 4-14 AWG Bagged Insulated Tap Connector, Black", category: "Wiring & Cable Management", unit_price: 13.97, unit: "each", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "Solar Panel Clips (Pack of 50)", category: "Wiring & Cable Management", unit_price: 10.0, unit: "each", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "MC4 Connector Pair", category: "Wiring & Cable Management", unit_price: 3.25, unit: "per pair", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "10 AWG PV Wire (Black)", category: "Wiring & Cable Management", unit_price: 0.68, unit: "per foot", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "10 AWG PV Wire (Green) - per foot", category: "Wiring & Cable Management", unit_price: 0.68, unit: "ft", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "10 AWG PV Wire (White) - per foot", category: "Wiring & Cable Management", unit_price: 0.98, unit: "ft", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "10 AWG PV Wire (Red)", category: "Wiring & Cable Management", unit_price: 0.68, unit: "per foot", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "Wire Nuts - Blue (100pk)", category: "Wiring & Cable Management", unit_price: 6.5, unit: "per 100 pack", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "Wire Nuts - Red (100pk)", category: "Wiring & Cable Management", unit_price: 7.25, unit: "per 100 pack", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "Wire Nuts - Yellow (100pk)", category: "Wiring & Cable Management", unit_price: 8.5, unit: "per 100 pack", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "8\" Black UV-Rated Zip Ties (100pk)", category: "Wiring & Cable Management", unit_price: 6.75, unit: "per 100 pack", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "14\" Black UV-Rated Zip Ties (100pk)", category: "Wiring & Cable Management", unit_price: 12.5, unit: "per 100 pack", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "11 inch Black UV-Rated Zip Ties (100pk)", category: "Wiring & Cable Management", unit_price: 9.48, unit: "per 100 pack", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "MC4 Y-Branch Connector Pair", category: "Wiring & Cable Management", unit_price: 8.5, unit: "per pair", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "Split-Bolt Connector (3-pack)", category: "Wiring & Cable Management", unit_price: 4.75, unit: "per 3-pack", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "#12 Black Stranded Copper THHN Wire", category: "Wiring & Cable Management", unit_price: 0.97, unit: "ft", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "#12 Green Stranded CU THHN Wire", category: "Wiring & Cable Management", unit_price: 0.97, unit: "ft", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "#12 White Stranded CU THHN Wire - 1 FT", category: "Wiring & Cable Management", unit_price: 0.96, unit: "each", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "#8 THHN Stranded Copper", category: "Wiring & Cable Management", unit_price: 1.15, unit: "per foot", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "#10 THHN Stranded Copper", category: "Wiring & Cable Management", unit_price: 0.57, unit: "per foot", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "#6 THHN Stranded Copper", category: "Wiring & Cable Management", unit_price: 1.85, unit: "per foot", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "Homeline 60 Amp 2-Pole Circuit Breaker (HOM260CP)", category: "Wiring & Cable Management", unit_price: 17.47, unit: "each", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" },
  { name: "POLARIS Multitap Connector: 2 Port, Double-Sided Entry, 14 AWG - 4 AWG Wire Size, Black", category: "Wiring & Cable Management", unit_price: 24.39, unit: "each", tax_category: "SOLAR_CABLES_CONNECTORS", tax_code: "TTR146716" }
];

'@ | Set-Content -Encoding utf8 "$destDir\productCatalog.js"
Write-Host "  Wrote: src/features/quoteDraftAgent/productCatalog.js"

Write-Host "Writing draftEngine.js (matching + pricing engine)..."
@'
// draftEngine.js
//
// Replicates the Quote Draft Agent (Step 2) logic LOCALLY, in the browser,
// with no LLM/API calls of any kind. Takes the structured output of the
// Quote Request Agent (Step 1) and produces: a scope-of-work paragraph,
// matched product/service/material line items (with real unit prices and
// tax codes from the product catalog), FST labor hours, travel hours,
// miles traveled, and an assumptions/notes summary -- mirroring the rules
// in the Quote Draft Agent Prompt (Step 2).
//
// This does NOT compute a final dollar total or sales tax -- EnQuote's own
// form already has federal/state/local tax percent fields and computes
// subtotal/discount/tax itself from the items + labor + travel this engine
// produces. This engine's job stops at producing accurate, tax-coded line
// items and labor/travel figures.

import { PRODUCT_CATALOG } from "./productCatalog";

// --- Tax code reference (from the Quote Draft Agent prompt) --------------
const TAX_CODES = {
  SERVICES: "SS300220",
  MICROINVERTER: "TTR146714",
  SOLAR_ACCESSORY: "TTR146718",
  SOLAR_CABLES_CONNECTORS: "TTR146716",
  COMMUNICATION_ACCESSORY: "TTR146719",
  GENERAL_ELECTRICAL_EQUIPMENT: "TTR152589"
};

// Maps a catalog "category" (as found in the spreadsheet) to one of the
// Quote Draft Agent's official Materials section names.
const CATEGORY_TO_SECTION = {
  "Wiring & Cable Management": "Electrical Materials",
  "Breakers": "Electrical Materials",
  "Conduit & Raceway": "Electrical Materials",
  "Enclosure": "Electrical Materials",
  "Junction Box": "Electrical Materials",
  "Microinverters": "Electrical Materials",
  "Critter Guard": "Critter Guard Materials",
  "Mounting / Racking": "Electrical Materials",
  "Roof Mounting & Sealing": "Weatherproofing Materials",
  "Rental Equipment": "Electrical Materials",
  "Enphase Products": "Electrical Materials",
  "Services": null // handled separately -- not a materials section
};

// Default average price per category, used ONLY when no catalog match is
// confident enough -- mirrors the team's own documented fallback rule:
// "if the tech puts in a product that isn't found on the product list, the
// agent would select the miscellaneous product... with the average price."
function computeCategoryAverages(catalog) {
  const sums = {};
  const counts = {};
  for (const item of catalog) {
    sums[item.category] = (sums[item.category] || 0) + item.unit_price;
    counts[item.category] = (counts[item.category] || 0) + 1;
  }
  const averages = {};
  for (const category of Object.keys(sums)) {
    averages[category] = Math.round((sums[category] / counts[category]) * 100) / 100;
  }
  return averages;
}

const CATEGORY_AVERAGES = computeCategoryAverages(PRODUCT_CATALOG);

// --- Text matching --------------------------------------------------------
const STOPWORDS = new Set([
  "the", "a", "an", "of", "for", "and", "or", "to", "in", "on", "with",
  "each", "per", "pack", "set", "kit", "required", "replacement", "repair",
  "damaged", "damage", "verify", "operation", "operating", "system",
  "install", "installed", "remove", "existing", "new", "restore",
  "affected", "confirm", "normal"
]);

// Catalog categories that represent LABOR/SERVICE charges rather than
// physical parts. Products and materials must never match into this
// category (a physical cable should never resolve to a labor line), and
// services must ONLY match within this category -- never against an
// unrelated physical product just because a word like "wire" or "repair"
// happens to appear in both.
const SERVICE_CATEGORY = "Services";

// Words that, ALONE, are too generic to confidently select one specific
// catalog SKU out of many (e.g. dozens of catalog entries contain
// "connector" or "cable"). If a requested item's core tokens reduce to
// ONLY generic terms with no specific/technical qualifier (a model name,
// "Q", "MC4", "trunk", a brand, etc.), this engine will not guess a
// specific product -- it uses the category-average fallback instead and
// flags the item for manual verification, rather than risk pricing the
// wrong part.
const GENERIC_TERMS = new Set([
  "wire", "wires", "cable", "cables", "connector", "connectors",
  "clip", "clips", "bracket", "brackets", "material", "materials",
  "part", "parts", "component", "components", "accessory", "accessories",
  "hardware", "fastener", "fasteners"
]);

function normalizeForPhraseMatch(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text) {
  return normalizeForPhraseMatch(text)
    .split(" ")
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

function hasSpecificTerm(coreTokens) {
  return coreTokens.some((t) => !GENERIC_TERMS.has(t));
}

// Checks whether the requested item's name appears as a contiguous,
// WORD-BOUNDARY-aware phrase within a catalog item's name. This is
// deliberately stricter than a raw substring check: matching is done on
// tokenized word sequences, so "Q Cable" matching inside "IQ Cable" (a
// character-level coincidence -- "IQ" ends in "Q") is correctly rejected,
// while "Q Cable" matching inside "Enphase Q Cable Landscape" (a genuine
// whole-word match) is correctly accepted.
//
// Only queries with 2 or more meaningful words are eligible for phrase
// matching at all -- a single generic word (e.g. "Connectors") must never
// be treated as a strong phrase signal, since it will coincidentally
// appear inside many unrelated item names/descriptions.
function findPhraseMatch(requestedName, candidates) {
  const queryTokens = normalizeForPhraseMatch(requestedName).split(" ").filter(Boolean);
  if (queryTokens.length < 2) return null;

  for (const item of candidates) {
    const nameTokens = normalizeForPhraseMatch(item.name).split(" ").filter(Boolean);
    if (containsSubsequence(nameTokens, queryTokens)) {
      return item;
    }
  }
  return null;
}

// Returns true if `needle` appears as a contiguous run of whole tokens
// somewhere inside `haystack`.
function containsSubsequence(haystackTokens, needleTokens) {
  if (needleTokens.length === 0 || needleTokens.length > haystackTokens.length) return false;
  for (let i = 0; i <= haystackTokens.length - needleTokens.length; i++) {
    let matchesHere = true;
    for (let j = 0; j < needleTokens.length; j++) {
      if (haystackTokens[i + j] !== needleTokens[j]) {
        matchesHere = false;
        break;
      }
    }
    if (matchesHere) return true;
  }
  return false;
}

// Scores a catalog item against the CORE request tokens (the item's own
// name, e.g. "Q Cable" or "Connectors" -- NOT free-text notes, which are
// symptom/context descriptions and too noisy to use for matching). Notes
// are only used as a small tiebreaker signal, never as the primary basis
// for a match, and can never push an unmatched item over the confidence
// threshold on their own.
function scoreMatch(coreTokens, noteTokens, catalogItem) {
  const nameTokens = tokenize(catalogItem.name);
  const descTokens = tokenize(catalogItem.description || "");

  let coreHits = 0;
  let coreScore = 0;
  for (const token of coreTokens) {
    if (nameTokens.includes(token)) {
      coreHits += 1;
      coreScore += 3;
    } else if (descTokens.includes(token)) {
      coreHits += 1;
      coreScore += 1;
    }
  }

  let noteScore = 0;
  for (const token of noteTokens) {
    if (nameTokens.includes(token)) noteScore += 0.5;
  }

  const coverage = coreTokens.length > 0 ? coreHits / coreTokens.length : 0;
  return { score: coreScore + noteScore, coverage, coreHits };
}

// Optional category hint narrows the search (e.g. "critter guard" requests
// should prefer the Critter Guard category) without excluding other
// categories entirely, in case the right item lives elsewhere. `isService`
// hard-filters candidates to (or away from) the Services category -- this
// is a hard rule, not a soft preference, because a labor/service request
// must never resolve to a physical product and vice versa.
function findBestCatalogMatch(requestedName, notesText, categoryHint, isService) {
  const coreTokens = tokenize(requestedName);
  const noteTokens = tokenize(notesText);
  if (coreTokens.length === 0) return { match: null, score: 0, coverage: 0 };

  const candidates = PRODUCT_CATALOG.filter((item) =>
    isService ? item.category === SERVICE_CATEGORY : item.category !== SERVICE_CATEGORY
  );

  let best = null;
  let bestScore = 0;
  let bestCoverage = 0;
  for (const item of candidates) {
    const { score, coverage } = scoreMatch(coreTokens, noteTokens, item);
    let adjustedScore = score;
    if (categoryHint && item.category === categoryHint) adjustedScore += 1.5;
    if (adjustedScore > bestScore) {
      bestScore = adjustedScore;
      bestCoverage = coverage;
      best = item;
    }
  }
  return { match: best, score: bestScore, coverage: bestCoverage };
}

// A match is only trusted when BOTH a minimum raw score is met AND a
// minimum proportion of the requested item's own core words are found in
// the catalog item's name. The coverage requirement is what prevents a
// single shared incidental word (e.g. "wire") from producing a confident
// but wrong match -- every meaningful word in a short request like
// "Q Cable" or "Connectors" must actually be present.
const MATCH_SCORE_THRESHOLD = 3;
const MATCH_COVERAGE_THRESHOLD = 0.5;

// Guesses the most likely category for an unmatched item based on keywords
// in its name, so the miscellaneous fallback price/tax-code is at least
// in the right ballpark category.
const CATEGORY_KEYWORDS = [
  { category: "Critter Guard", keywords: ["critter", "rodent", "animal", "chew", "pest"] },
  { category: "Wiring & Cable Management", keywords: ["wire", "cable", "connector", "splice", "conductor", "awg"] },
  { category: "Microinverters", keywords: ["microinverter", "micro inverter", "iq7", "iq8"] },
  { category: "Roof Mounting & Sealing", keywords: ["roof", "flashing", "sealant", "seal", "clamp", "mount"] },
  { category: "Breakers", keywords: ["breaker", "fuse"] },
  { category: "Junction Box", keywords: ["junction", "box", "enclosure", "disconnect"] },
  { category: "Conduit & Raceway", keywords: ["conduit", "raceway", "emt", "pvc"] },
  { category: "Rental Equipment", keywords: ["rental", "ladder", "lift", "truck"] }
];

function guessCategoryFromText(text) {
  const lower = String(text || "").toLowerCase();
  for (const entry of CATEGORY_KEYWORDS) {
    if (entry.keywords.some((kw) => lower.includes(kw))) return entry.category;
  }
  return "Wiring & Cable Management"; // safest general default for solar repair parts
}

// Matches a single requested line (product, service, or additional
// material) against the catalog, returning a fully-priced, tax-coded line
// item ready for EnQuote's `items` array. Falls back to a labeled
// "Miscellaneous <category>" placeholder with the category's average price
// when no confident match exists -- never fabricates a specific product or
// price outside catalog data.
function matchLineItem(requestedName, requestedQuantity, notes, categoryHint, isService) {
  const quantity = normalizeQuantity(requestedQuantity);
  const coreTokens = tokenize(requestedName);
  const candidates = PRODUCT_CATALOG.filter((item) =>
    isService ? item.category === SERVICE_CATEGORY : item.category !== SERVICE_CATEGORY
  );

  // A request must contain at least one specific/technical word (not just
  // generic terms like "cable", "connector", "wire" alone) before this
  // engine will attempt ANY specific-SKU match -- phrase match included.
  // This is checked first so a coincidental word overlap in an unrelated
  // item's name can never bypass the safeguard.
  const canAttemptSpecificMatch = hasSpecificTerm(coreTokens);

  // Strongest signal: the requested name appears nearly verbatim, as whole
  // words, inside a catalog item's name (e.g. "Q Cable" inside
  // "Enphase Q Cable Landscape").
  const phraseMatch = canAttemptSpecificMatch ? findPhraseMatch(requestedName, candidates) : null;
  if (phraseMatch) {
    return {
      requested_name: requestedName,
      name: phraseMatch.name,
      quantity,
      unit_price: phraseMatch.unit_price,
      unit: phraseMatch.unit,
      total: Math.round(phraseMatch.unit_price * quantity * 100) / 100,
      taxable: true,
      tax_code: phraseMatch.tax_code,
      section: CATEGORY_TO_SECTION[phraseMatch.category] || "Electrical Materials",
      matched: true,
      match_confidence: "phrase"
    };
  }

  // (canAttemptSpecificMatch already computed above, before the phrase
  // match attempt, so both matching strategies share the same safeguard.)
  const { match, score, coverage } = canAttemptSpecificMatch
    ? findBestCatalogMatch(requestedName, notes, categoryHint, isService)
    : { match: null, score: 0, coverage: 0 };

  const confidentMatch = match && score >= MATCH_SCORE_THRESHOLD && coverage >= MATCH_COVERAGE_THRESHOLD;

  if (confidentMatch) {
    return {
      requested_name: requestedName,
      name: match.name,
      quantity,
      unit_price: match.unit_price,
      unit: match.unit,
      total: Math.round(match.unit_price * quantity * 100) / 100,
      taxable: true,
      tax_code: match.tax_code,
      section: CATEGORY_TO_SECTION[match.category] || "Electrical Materials",
      matched: true,
      match_confidence: score
    };
  }

  // No confident catalog match -- use the category-average fallback.
  const searchText = `${requestedName} ${notes || ""}`;
  const guessedCategory = isService
    ? SERVICE_CATEGORY
    : (guessCategoryFromText(searchText) || categoryHint || "Wiring & Cable Management");
  const averagePrice = CATEGORY_AVERAGES[guessedCategory] || 25;
  const fallbackTaxCategory = PRODUCT_CATALOG.find((i) => i.category === guessedCategory)?.tax_category
    || "GENERAL_ELECTRICAL_EQUIPMENT";
  const fallbackTaxCode = TAX_CODES[fallbackTaxCategory] || TAX_CODES.GENERAL_ELECTRICAL_EQUIPMENT;

  return {
    requested_name: requestedName,
    name: `Miscellaneous ${guessedCategory} (unmatched: "${requestedName}")`,
    quantity,
    unit_price: averagePrice,
    unit: "each",
    total: Math.round(averagePrice * quantity * 100) / 100,
    taxable: true,
    tax_code: fallbackTaxCode,
    section: CATEGORY_TO_SECTION[guessedCategory] || "Electrical Materials",
    matched: false,
    match_confidence: score
  };
}

function normalizeQuantity(rawQuantity) {
  if (rawQuantity === null || rawQuantity === undefined) return 1;
  const str = String(rawQuantity).trim();
  if (!str || /^unknown$/i.test(str)) return 1;
  const num = parseFloat(str.replace(/[^\d.]/g, ""));
  return isNaN(num) || num <= 0 ? 1 : num;
}

// --- Labor & travel (same rules as the Step 2 prompt) ---------------------
const DEFAULT_LABOR_RATE = 125;
const TRAVEL_HOUR_RATE = 65;
const MILEAGE_RATE = 0.73;

function resolveWorstCase(value) {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (!str || /^unknown$/i.test(str)) return null;
  const rangeMatch = str.match(/([\d.]+)\s*(?:-|to)\s*([\d.]+)/i);
  if (rangeMatch) {
    return Math.max(parseFloat(rangeMatch[1]), parseFloat(rangeMatch[2]));
  }
  const singleMatch = str.match(/[\d.]+/);
  return singleMatch ? parseFloat(singleMatch[0]) : null;
}

// --- Scope of work generation (template-based, no LLM) ---------------------
function generateScopeOfWork(request) {
  const parts = [];

  if (request.scopeDescription) {
    parts.push(request.scopeDescription.trim());
  } else if (request.problemDescription || request.rootCause) {
    const problem = request.problemDescription ? request.problemDescription.trim() : "";
    const cause = request.rootCause ? request.rootCause.trim() : "";
    if (problem) parts.push(problem);
    if (cause && cause.toLowerCase() !== problem.toLowerCase()) {
      parts.push(`Root cause identified as: ${cause}`);
    }
  }

  if (request.diagnosticFindings) {
    parts.push(request.diagnosticFindings.trim());
  }

  if (parts.length === 0) {
    return "Scope of work requires manual entry -- insufficient detail was provided in the quote request to generate a summary.";
  }

  return parts.join(" ");
}

// --- Assumption / notes generation ----------------------------------------
function generateAssumptions(request, { fstCount, laborHours, usedWorstCase, unmatchedItems }) {
  const notes = [];

  if (usedWorstCase) {
    notes.push("Worst-case labor estimate used per request guidance (a range was provided).");
  }
  notes.push(`${fstCount} technician${fstCount === 1 ? "" : "s"} assigned.`);
  notes.push(`Estimated onsite labor hours: ${laborHours} hour${laborHours === 1 ? "" : "s"}.`);
  notes.push(`Labor rate assumed at $${DEFAULT_LABOR_RATE.toFixed(2)}/hour (organization default -- no rate was specified in the request).`);
  notes.push(`Travel billed at $${TRAVEL_HOUR_RATE.toFixed(2)}/hour and $${MILEAGE_RATE.toFixed(2)}/mile per standard rates.`);

  if (unmatchedItems.length > 0) {
    notes.push(
      `The following requested items had no confident catalog match and were priced using the category average as a placeholder -- please verify before finalizing: ${unmatchedItems.join(", ")}.`
    );
  }

  return notes.join(" ");
}

function generateRiskStatement(request, { hasUnknowns, unmatchedItems }) {
  if (!hasUnknowns && unmatchedItems.length === 0) return "";
  return "This quote assumes replacement of the identified damaged components and materials described above. If additional hidden damage is discovered after module removal, branch circuit exposure, or system inspection, additional labor and/or materials may be required and would be communicated through a change order requiring customer approval.";
}

// --- Main entry point -------------------------------------------------------
// `request` shape (produced by parsing Step 1 output -- see
// quoteRequestTextParser.js):
// {
//   siteId, caseNumber, customer, siteAddress, quoteCategory,
//   problemDescription, rootCause, diagnosticFindings, scopeDescription,
//   technicianCount, onsiteLaborHours, totalLaborHours,
//   driveHours, driveMiles,
//   products: [{ name, quantity, unit, notes }],
//   services: [{ name, quantity, unit, notes }],
//   materials: [{ name, quantity, unit, notes }],
//   hasUnknownFields: boolean
// }
export function generateQuoteDraft(request) {
  const fstCount = Math.round(resolveWorstCase(request.technicianCount) || 1);
  const laborHours = resolveWorstCase(request.onsiteLaborHours)
    ?? resolveWorstCase(request.totalLaborHours)
    ?? 0;
  const usedWorstCase = /(-|to)/i.test(String(request.onsiteLaborHours || request.totalLaborHours || ""));

  const travelHours = resolveWorstCase(request.driveHours) || 0;
  const milesTraveled = resolveWorstCase(request.driveMiles) || 0;

  const items = [];
  const unmatchedItems = [];

  const allRequestedLines = [
    ...(request.products || []).map((p) => ({ ...p, kind: "product" })),
    ...(request.materials || []).map((m) => ({ ...m, kind: "material" })),
    ...(request.services || [])
      .map((s) => ({ ...s, kind: "service", name: s.name }))
  ];

  for (const line of allRequestedLines) {
    if (!line.name) continue;
    const isService = line.kind === "service";
    const categoryHint = isService ? "Services" : guessCategoryFromText(`${line.name} ${line.notes || ""}`);
    const lineItem = matchLineItem(line.name, line.quantity, line.notes, categoryHint, isService);

    // Services priced at $0 in the catalog represent labor already covered
    // by the FST's hourly on-site labor charge -- skip adding a duplicate
    // $0 line, but DO add any service with a genuine flat fee (e.g.
    // Comprehensive Diagnostic, AHJ Permitting).
    if (line.kind === "service" && lineItem.matched && lineItem.unit_price === 0) {
      continue;
    }

    items.push(lineItem);
    if (!lineItem.matched) unmatchedItems.push(line.name);
  }

  const scopeOfWork = generateScopeOfWork(request);
  const notes = generateAssumptions(request, { fstCount, laborHours, usedWorstCase, unmatchedItems });
  const riskStatement = generateRiskStatement(request, {
    hasUnknowns: Boolean(request.hasUnknownFields),
    unmatchedItems
  });

  return {
    site_id: request.siteId || "",
    case_number: request.caseNumber || "",
    customer: request.customer || "",
    site_address: request.siteAddress || "",
    scope_of_work: scopeOfWork,
    fst_count: fstCount,
    labor_hours: laborHours,
    labor_rate: DEFAULT_LABOR_RATE,
    travel_hours: travelHours,
    travel_rate: TRAVEL_HOUR_RATE,
    miles_traveled: milesTraveled,
    mileage_rate: MILEAGE_RATE,
    items: items.map((item) => ({
      product_id: null,
      name: item.name,
      quantity: item.quantity,
      unit_price: item.unit_price,
      unit: item.unit,
      total: item.total,
      taxable: item.taxable,
      tax_code: item.tax_code
    })),
    notes: [notes, riskStatement].filter(Boolean).join("\n\n"),
    unmatched_count: unmatchedItems.length,
    unmatched_items: unmatchedItems
  };
}

export { findBestCatalogMatch, matchLineItem, CATEGORY_AVERAGES, TAX_CODES };

'@ | Set-Content -Encoding utf8 "$destDir\draftEngine.js"
Write-Host "  Wrote: src/features/quoteDraftAgent/draftEngine.js"

Write-Host "Writing quoteRequestTextParser.js (Step 1 output parser)..."
@'
// quoteRequestTextParser.js
//
// Parses the plain-text output printed by the Quote Request Agent (Step 1)
// into a structured object consumed by draftEngine.js. Pure text parsing --
// no API calls, no LLM.

function cleanLine(line) {
  return line
    .replace(/\u00A0/g, " ")
    .replace(/\*\*/g, "")
    .replace(/^[-*\u2022\u2023\u25E6\u2043\u2219\u25AA\u25CF]\s*/, "")
    .trim();
}

function toLines(rawText) {
  return rawText
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => cleanLine(l))
    .filter((l) => l.length > 0);
}

function isUnknown(value) {
  if (!value) return true;
  return /^(unknown|n\/?a|none|tbd)$/i.test(String(value).trim());
}

function extractField(lines, label) {
  const re = new RegExp("^" + label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ":\\s*(.+)$", "i");
  for (const line of lines) {
    const match = line.match(re);
    if (match) return match[1].trim();
  }
  return null;
}

function findSectionIndex(lines, heading) {
  return lines.findIndex((l) => l.toLowerCase() === heading.toLowerCase());
}

function sliceSection(lines, heading, nextHeadings) {
  const start = findSectionIndex(lines, heading);
  if (start === -1) return [];
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (nextHeadings.some((h) => lines[i].toLowerCase() === h.toLowerCase())) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end);
}

// Parses a repeating "Item Name: X / Quantity: Y / Unit: Z / Notes: W" block
// into an array of entries. Each new "<label>:" that matches the first
// field name starts a new entry.
function parseRepeatingEntries(sectionLines, firstFieldLabel, fieldMap) {
  const entries = [];
  let current = null;

  const firstFieldRe = new RegExp("^" + firstFieldLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ":\\s*(.+)$", "i");

  for (const line of sectionLines) {
    const firstMatch = line.match(firstFieldRe);
    if (firstMatch) {
      if (current) entries.push(current);
      current = { name: firstMatch[1].trim() };
      continue;
    }
    if (!current) continue;
    for (const [label, key] of Object.entries(fieldMap)) {
      const re = new RegExp("^" + label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ":\\s*(.+)$", "i");
      const match = line.match(re);
      if (match) {
        current[key] = match[1].trim();
      }
    }
  }
  if (current) entries.push(current);

  // Drop "None" / "None Required" style empty entries.
  return entries.filter((e) => e.name && !isUnknown(e.name) && !/^none required$/i.test(e.name));
}

export function parseQuoteRequestOutput(rawText) {
  if (!rawText || !rawText.trim()) {
    throw new Error("Paste the Quote Request Agent output before generating a draft.");
  }

  const lines = toLines(rawText);

  const siteId = extractField(lines, "Site ID");
  const caseNumber = extractField(lines, "Case Number");
  const customer = extractField(lines, "Customer Name") || extractField(lines, "Customer");
  const siteAddress = extractField(lines, "Site Address");
  const quoteCategory = extractField(lines, "Quote Category");

  const problemDescription = extractField(lines, "Problem Description");
  const rootCause = extractField(lines, "Root Cause");
  const diagnosticFindings = extractField(lines, "Diagnostic Findings");
  const scopeDescription = extractField(lines, "Scope Description");

  const technicianCount = extractField(lines, "Technician Count");
  const onsiteLaborHours = extractField(lines, "Estimated Onsite Labor Hours");
  const totalLaborHours = extractField(lines, "Estimated Total Labor Hours");

  const driveHours = extractField(lines, "Total Drive Hours");
  const driveMiles = extractField(lines, "Total Drive Miles");

  const productsSection = sliceSection(lines, "Products", ["Services", "Additional Materials", "Warranty Replacements", "Technician Recommendations"]);
  const servicesSection = sliceSection(lines, "Services", ["Additional Materials", "Warranty Replacements", "Technician Recommendations"]);
  const materialsSection = sliceSection(lines, "Additional Materials", ["Warranty Replacements", "Technician Recommendations"]);

  const products = parseRepeatingEntries(productsSection, "Item Name", {
    "Quantity": "quantity",
    "Unit": "unit",
    "Notes": "notes"
  });
  const services = parseRepeatingEntries(servicesSection, "Service Name", {
    "Quantity": "quantity",
    "Unit": "unit",
    "Notes": "notes"
  });
  const materials = parseRepeatingEntries(materialsSection, "Item Name", {
    "Quantity": "quantity",
    "Unit": "unit",
    "Notes": "notes"
  });

  // Detect if any Required/Conditional field was submitted as "Unknown" --
  // used to decide whether a risk statement should be included.
  const fieldsToCheck = [
    siteId, caseNumber, customer, siteAddress, problemDescription, rootCause,
    diagnosticFindings, scopeDescription, technicianCount, onsiteLaborHours,
    driveHours, driveMiles
  ];
  const hasUnknownFields = fieldsToCheck.some((f) => isUnknown(f));

  return {
    siteId: isUnknown(siteId) ? "" : siteId || "",
    caseNumber: isUnknown(caseNumber) ? "" : caseNumber || "",
    customer: isUnknown(customer) ? "" : customer || "",
    siteAddress: isUnknown(siteAddress) ? "" : siteAddress || "",
    quoteCategory: isUnknown(quoteCategory) ? "" : quoteCategory || "",
    problemDescription: isUnknown(problemDescription) ? "" : problemDescription || "",
    rootCause: isUnknown(rootCause) ? "" : rootCause || "",
    diagnosticFindings: isUnknown(diagnosticFindings) ? "" : diagnosticFindings || "",
    scopeDescription: isUnknown(scopeDescription) ? "" : scopeDescription || "",
    technicianCount: isUnknown(technicianCount) ? null : technicianCount,
    onsiteLaborHours: isUnknown(onsiteLaborHours) ? null : onsiteLaborHours,
    totalLaborHours: isUnknown(totalLaborHours) ? null : totalLaborHours,
    driveHours: isUnknown(driveHours) ? null : driveHours,
    driveMiles: isUnknown(driveMiles) ? null : driveMiles,
    products,
    services,
    materials,
    hasUnknownFields
  };
}

// Evidence check: does this look like genuine Step 1 (Quote Request Agent)
// output, as opposed to random text or already-priced Step 2 output?
export function hasQuoteRequestEvidence(rawText) {
  const text = rawText || "";
  const markers = [
    /site id:/i,
    /case number:/i,
    /quote category:/i,
    /recommended scope of work/i,
    /technician count:/i,
    /diagnostic findings:/i
  ];
  return markers.filter((m) => m.test(text)).length >= 2;
}

'@ | Set-Content -Encoding utf8 "$destDir\quoteRequestTextParser.js"
Write-Host "  Wrote: src/features/quoteDraftAgent/quoteRequestTextParser.js"

Write-Host "Writing QuoteDraftButton.jsx (updated UI: Step 1 input -> priced Step 2 output)..."
@'
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, Check, AlertTriangle, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { parseQuoteRequestOutput, hasQuoteRequestEvidence } from "./quoteRequestTextParser";
import { generateQuoteDraft } from "./draftEngine";

// Quote Draft Agent (Step 2) -- LOCAL, in-app replacement.
//
// The input to this dialog is the plain text printed by the Quote Request
// Agent (Step 1) -- the same text an FST posts in Salesforce. This
// component then does what the Step 2 Copilot Studio agent used to do
// manually: it matches requested products/services/materials against the
// real product catalog, assigns real prices and Avalara tax codes,
// computes FST labor hours and travel, and generates a scope-of-work
// summary -- entirely in the browser. No API calls, no Base44 AI, no LLM
// invocation of any kind.

const QUOTE_REQUEST_AGENT_URL =
  "https://m365.cloud.microsoft/chat/?titleId=T_03e793b7-91a0-99a1-13a8-9cc6f331a45e&source=embedded-builder";

const MANUAL_INPUT_PLACEHOLDER = "Requires Manual Input";

function computeValidUntil() {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  return date.toISOString().slice(0, 10);
}

function toFormUpdates(draft) {
  const updates = {
    site_id: draft.site_id || MANUAL_INPUT_PLACEHOLDER,
    quote_requester: MANUAL_INPUT_PLACEHOLDER, // Step 1 output does not include a requester field
    case_number: draft.case_number || MANUAL_INPUT_PLACEHOLDER,
    valid_until: computeValidUntil(),
    scope_of_work: draft.scope_of_work || MANUAL_INPUT_PLACEHOLDER,
    fst_count: draft.fst_count || undefined,
    labor_hours: draft.labor_hours || undefined,
    labor_rate: draft.labor_rate || undefined,
    travel_hours: draft.travel_hours || undefined,
    travel_rate: draft.travel_rate || undefined,
    miles_traveled: draft.miles_traveled || undefined,
    mileage_rate: draft.mileage_rate || undefined,
    labor_mode: "hourly",
    notes: draft.notes || undefined
  };

  if (Array.isArray(draft.items) && draft.items.length > 0) {
    updates.items = draft.items;
  }

  Object.keys(updates).forEach((key) => updates[key] === undefined && delete updates[key]);
  return updates;
}

function getMissingRequiredFields(draft) {
  const missing = [];
  if (!draft.site_id) missing.push("Site ID");
  missing.push("Quote Requester"); // never provided by Step 1 output
  if (!draft.case_number) missing.push("Case Number");
  if (!draft.scope_of_work) missing.push("Scope of Work Description");
  if (!draft.fst_count) missing.push("Number of FSTs Needed");
  if (!draft.labor_hours) missing.push("Number of Labor Hours on Site");
  if (!draft.travel_hours) missing.push("Total Travel Hours (combined)");
  if (!draft.miles_traveled) missing.push("Miles Traveled (combined)");
  return missing;
}

export default function QuoteDraftButton({ quote, products, onApply }) {
  const [open, setOpen] = useState(false);
  const [rawOutput, setRawOutput] = useState("");
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [notStep1Warning, setNotStep1Warning] = useState(false);

  const closeDialog = () => {
    setOpen(false);
    setRawOutput("");
    setPreview(null);
    setError(null);
    setNotStep1Warning(false);
  };

  const handlePreview = () => {
    setError(null);
    setNotStep1Warning(false);
    try {
      if (!hasQuoteRequestEvidence(rawOutput)) {
        setNotStep1Warning(true);
        setPreview(null);
        return;
      }
      const parsedRequest = parseQuoteRequestOutput(rawOutput);
      const draft = generateQuoteDraft(parsedRequest);
      setPreview(draft);
    } catch (err) {
      setError(err.message || "Could not parse the pasted output.");
      setPreview(null);
    }
  };

  const handleApply = () => {
    if (!preview) return;
    const updates = toFormUpdates(preview);
    onApply?.(updates);
    const missing = getMissingRequiredFields(preview);
    if (missing.length > 0 || preview.unmatched_count > 0) {
      const parts = [];
      if (missing.length > 0) parts.push(`${missing.length} field(s) need manual input: ${missing.join(", ")}`);
      if (preview.unmatched_count > 0) parts.push(`${preview.unmatched_count} item(s) used estimated placeholder pricing`);
      toast.warning(`Applied. ${parts.join(". ")}.`);
    } else {
      toast.success("Quote draft applied. Review all fields and pricing before saving.");
    }
    closeDialog();
  };

  const missingFields = preview ? getMissingRequiredFields(preview) : [];

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        className="border-indigo-300 bg-white text-indigo-700 hover:bg-indigo-50"
      >
        <Sparkles className="w-4 h-4 mr-2" />
        Quote Draft Agent
      </Button>

      <Dialog open={open} onOpenChange={(next) => (!next ? closeDialog() : setOpen(next))}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Quote Draft Agent (Step 2)</DialogTitle>
            <DialogDescription>
              Paste the output printed by the Quote Request Agent (Step 1) below. This is matched
              against the product catalog and priced entirely in your browser -- no data is sent to
              Base44, Copilot Studio, or any other service to do this.
            </DialogDescription>
          </DialogHeader>

          <a
            href={QUOTE_REQUEST_AGENT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-700 hover:underline -mt-2"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Open the Quote Request Agent (Step 1) chat to generate this output
          </a>

          {!preview ? (
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">
                Paste Quote Request Agent Output
              </label>
              <Textarea
                value={rawOutput}
                onChange={(event) => setRawOutput(event.target.value)}
                placeholder="Paste the Quote Request output from the Quote Request Agent (Step 1) here..."
                rows={14}
              />
              {error && (
                <p className="text-sm text-red-600 flex items-center gap-1">
                  <AlertTriangle className="w-4 h-4" /> {error}
                </p>
              )}
              {notStep1Warning && (
                <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
                  <p className="flex items-center gap-1 font-medium">
                    <AlertTriangle className="w-4 h-4" />
                    This does not look like Quote Request Agent (Step 1) output.
                  </p>
                  <p>
                    Expected fields like "Site ID:", "Case Number:", or "Recommended Scope of Work"
                    were not found. Paste the text printed by the Quote Request Agent (Step 1) chat,
                    which is what FSTs post in Salesforce.
                  </p>
                  <p className="font-medium">What was received (first 500 characters):</p>
                  <pre className="bg-white border border-amber-200 rounded p-2 text-xs whitespace-pre-wrap max-h-40 overflow-y-auto">
                    {rawOutput.slice(0, 500) || "(nothing was pasted)"}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto text-sm">
              {(missingFields.length > 0 || preview.unmatched_count > 0) && (
                <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
                  {missingFields.length > 0 && (
                    <div>
                      <p className="font-medium flex items-center gap-1">
                        <AlertTriangle className="w-4 h-4" />
                        {missingFields.length} required field(s) need manual input:
                      </p>
                      <ul className="list-disc list-inside">
                        {missingFields.map((field) => (
                          <li key={field}>{field}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {preview.unmatched_count > 0 && (
                    <div>
                      <p className="font-medium flex items-center gap-1">
                        <AlertTriangle className="w-4 h-4" />
                        {preview.unmatched_count} item(s) used estimated placeholder pricing -- verify before saving:
                      </p>
                      <ul className="list-disc list-inside">
                        {preview.unmatched_items.map((name) => (
                          <li key={name}>{name}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div><span className="font-semibold">Site ID:</span> {preview.site_id || MANUAL_INPUT_PLACEHOLDER}</div>
                <div><span className="font-semibold">Case Number:</span> {preview.case_number || MANUAL_INPUT_PLACEHOLDER}</div>
                <div><span className="font-semibold">Valid Until:</span> {computeValidUntil()} (today + 30 days)</div>
                <div><span className="font-semibold">FSTs Needed:</span> {preview.fst_count || MANUAL_INPUT_PLACEHOLDER}</div>
                <div><span className="font-semibold">Labor Hours:</span> {preview.labor_hours || MANUAL_INPUT_PLACEHOLDER}</div>
                <div><span className="font-semibold">Travel Hours:</span> {preview.travel_hours || MANUAL_INPUT_PLACEHOLDER}</div>
                <div><span className="font-semibold">Miles Traveled:</span> {preview.miles_traveled || MANUAL_INPUT_PLACEHOLDER}</div>
              </div>

              <div>
                <p className="font-semibold text-slate-900">Scope of Work</p>
                <p className="text-slate-600 whitespace-pre-wrap">{preview.scope_of_work || MANUAL_INPUT_PLACEHOLDER}</p>
              </div>

              <div>
                <p className="font-semibold text-slate-900">Quote Items ({preview.items.length})</p>
                <ul className="list-disc list-inside text-slate-600">
                  {preview.items.map((item, index) => (
                    <li key={index}>
                      {item.quantity} x {item.name} -- ${item.unit_price} ({item.tax_code || "no tax code"})
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={closeDialog}>Cancel</Button>
            {!preview ? (
              <Button type="button" onClick={handlePreview}>
                <Sparkles className="w-4 h-4 mr-2" />
                Parse Output
              </Button>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={() => setPreview(null)}>Back</Button>
                <Button type="button" onClick={handleApply}>
                  <Check className="w-4 h-4 mr-2" />
                  Apply to Quote
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

'@ | Set-Content -Encoding utf8 "$destDir\QuoteDraftButton.jsx"
Write-Host "  Wrote: src/features/quoteDraftAgent/QuoteDraftButton.jsx"


Write-Host "Removing the now-superseded Step-2-text parser (no longer used --"
Write-Host "the input is Step 1 text now, not already-priced Step 2 text)..."
$oldParser = "$destDir\quoteDraftTextParser.js"
if (Test-Path $oldParser) {
  Remove-Item $oldParser -Force
  Write-Host "  Removed: $oldParser"
} else {
  Write-Host "  Already gone: $oldParser"
}

Write-Host ""
Write-Host "=== Done ==="
Write-Host "Restart your dev server (Ctrl+C, then npm.cmd run dev) and hard-refresh (Ctrl+Shift+R)."
Write-Host ""
Write-Host "How it works now:"
Write-Host "  1. FST posts Quote Request Agent (Step 1) output in Salesforce."
Write-Host "  2. Copy that text and paste it into the Quote Draft Agent button in EnQuote."
Write-Host "  3. Click Parse Output -- EnQuote matches products/services/materials"
Write-Host "     against the real catalog, assigns tax codes, computes labor/travel,"
Write-Host "     and generates a scope of work summary. No manual Step 2 agent run"
Write-Host "     is needed anymore."
Write-Host "  4. Review the preview (items flagged with placeholder pricing are"
Write-Host "     clearly marked) and click Apply to Quote."
