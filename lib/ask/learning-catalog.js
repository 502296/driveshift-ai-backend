// Editorial allowlist: IDs copied from the publisher's own pages, never from a model.
// General professional demonstrations, not vehicle-specific instructions. Additions
// require source-page review and an applicability/safety review before release.
const gatesVideo = (topic, id, filename, language, title) => ({
  topic, videoId: id, language, title, publisher: 'Gates', platform: 'publisher',
  url: new URL(`https://go.gates.com/rs/439-CTA-171/images/${filename}.mp4`).toString(),
  sourceUrl: 'https://go.gates.com/automarketingtoolbox',
  scope: language === 'es' ? 'Guía general de mantenimiento del fabricante.'
    : 'Manufacturer overview for understanding this system and its maintenance.',
});

export const VIDEO_CATALOG = Object.freeze([
  gatesVideo('belt_noise', 'gates-belt-en', 'Protect The Ride - Serpentine Belt Maintenance', 'en', 'Understanding serpentine-belt maintenance'),
  gatesVideo('belt_noise', 'gates-belt-es', 'Protect The Ride - Serpentine Belt Maintenance ES V01', 'es', 'Mantenimiento de la correa serpentina'),
  gatesVideo('cooling', 'gates-cooling-en', 'Protect The Ride - The Importance of Cooling System Maintenance', 'en', 'Understanding cooling-system maintenance'),
  gatesVideo('cooling', 'gates-cooling-es', 'Protect The Ride - The Importance of Cooling System Maintenance ES V01', 'es', 'Mantenimiento del sistema de enfriamiento'),
  gatesVideo('maintenance', 'gates-mileage-en', 'Protect The Ride - High Mileage', 'en', 'High-mileage vehicle maintenance'),
  gatesVideo('maintenance', 'gates-mileage-es', 'Protect The Ride - High Mileage ES V01', 'es', 'Mantenimiento de vehículos con alto kilometraje'),
  { topic: 'belt_noise', videoId: 'IQn8CnyG2Lg', language: 'en',
    title: 'Diagnosing drive-system belt noise', publisher: 'Dayco',
    sourceUrl: 'https://www.dayco.com/na-en/techhub/diagnosing-drive-system-belt-noise/',
    scope: 'Professional diagnosis of belt, pulley and tensioner noise; workshop procedures are for trained technicians.' },
  { topic: 'tire_wheel', videoId: 'fgpkV2xIawg', language: 'en',
    title: 'When to replace tires', publisher: 'Michelin',
    sourceUrl: 'https://www.michelinman.com/auto/auto-tips-and-advice/tire-buying-guide/when-do-i-need-new-tires',
    scope: 'Manufacturer overview of tire wear, condition and replacement signs.' },
  { topic: 'abs', videoId: 'A3ptaYTbTnY', language: 'en',
    title: 'How ABS works', publisher: 'Brembo',
    sourceUrl: 'https://www.bremboparts.com/america/en/brembo-expert/technical-details/technological-evolutions',
    scope: 'An explanation of anti-lock braking operation; individual systems differ.' },
  { topic: 'brake_fluid', videoId: 'fGzIzFoc93c', language: 'en',
    title: 'Understanding brake fluid', publisher: 'Brembo',
    sourceUrl: 'https://www.youtube.com/watch?v=fGzIzFoc93c',
    scope: 'An explanation of brake fluid and its role in a hydraulic braking system.' },
  { topic: 'obd_codes', videoId: '_qJymlwHcaU', language: 'en',
    title: 'Reading Diagnostic Trouble Codes', publisher: 'Bosch Diagnostics',
    sourceUrl: 'https://www.boschdiagnostics.com/tutorials',
    scope: 'Professional scan-tool demonstration; controls differ from DriveShift.' },
  { topic: 'live_data', videoId: 'nYuBAGbwqVw', language: 'en',
    title: 'Using live data', publisher: 'Bosch Diagnostics',
    sourceUrl: 'https://www.boschdiagnostics.com/tutorials',
    scope: 'Professional scan-tool demonstration; controls differ from DriveShift.' },
  { topic: 'starting_battery', videoId: 'YjUcN64aeoc', language: 'en',
    title: 'Solving a vehicle that is slow to start', publisher: 'Bosch Diagnostics',
    sourceUrl: 'https://www.boschdiagnostics.com/bosch-solves/solving-vehicle-slow-start',
    scope: 'Professional slow-cranking case study; not confirmation of your vehicle’s fault.' },
  { topic: 'engine_misfire', videoId: 'o7trFoVZfeY', language: 'en',
    title: 'Solving a vehicle with a rough running engine and a check engine light on',
    publisher: 'Bosch Diagnostics',
    sourceUrl: 'https://www.boschdiagnostics.com/bosch-solves/solving-vehicle-rough-running-engine-and-check-engine-light',
    scope: 'Professional case study; the same symptoms can have different causes.' },
]);

