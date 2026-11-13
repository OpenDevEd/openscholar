// The people behind Openscholar, as their own organisations list them in public (opendeved.net/about, ekitabu.com/team).
// Places are the countries named for each person in the 6 Nov 2026 call; only London is a city. Mock: nobody has agreed yet.
export const ORGS = {
  ode: { name: "Open Development & Education", short: "OpenDevEd", url: "https://www.opendeved.net", base: [["GB", "London"]], line: "A multinational and multicultural research team, working with an emphasis on equitable teams." },
  ekitabu: { name: "eKitabu", short: "eKitabu", url: "https://www.ekitabu.com", base: [["KE", "Nairobi"], ["RW", "Kigali"], ["MW", "Lilongwe"]], line: "Publishing stories of change, and building inclusive education across Africa, since 2012." },
};
// lon and lat place each pin: London for London, roughly the middle of the country otherwise.
export const TEAM = [
  { key: "bjorn", name: "Björn Haßler", role: "Director", org: "ode", cc: "GB", place: "London", lon: -0.1, lat: 51.5 },
  { key: "taskeen", name: "Taskeen Adam", role: "Co-Director", org: "ode", cc: "CA", place: "Canada", lon: -96, lat: 53 },
  { key: "will", name: "Will Clurman", role: "Co-Founder and CEO", org: "ekitabu", cc: "KE", place: "Kenya", lon: 37.9, lat: .3 },
  { key: "matt", name: "Matt Utterback", role: "Co-Founder", org: "ekitabu", cc: "US", place: "United States", lon: -98, lat: 39 },
  { key: "nafisa", name: "Nafisa Waziri", role: "Senior Portfolio Manager", org: "ode", cc: "NG", place: "Nigeria", lon: 8, lat: 9.6 },
  { key: "hassan", name: "Hassan Mansour", role: "Technology and Innovation Manager", org: "ode", cc: "MA", place: "Morocco", lon: -6.8, lat: 32 },
  { key: "mohammed", name: "Mohammed Charrad", role: "Technology Analyst", org: "ode", cc: "MA", place: "Morocco", lon: -6.8, lat: 32 },
  { key: "allan", name: "Allan Onyango", role: "Senior Manager, Finance and Administration", org: "ekitabu", cc: "KE", place: "Kenya", lon: 37.9, lat: .3 },
  { key: "gugulethu", name: "Gugulethu Dube", role: "Analyst", org: "ode", cc: "ZA", place: "South Africa", lon: 24.7, lat: -29 },
  { key: "eunice", name: "Eunice Jengo", role: "PhD Student", org: "ode", cc: "TZ", place: "Tanzania", lon: 35, lat: -6.3 },
];
// Each place once, with its people, in the order the map reads: north to south.
export const PLACES = [...new Set(TEAM.map((p) => p.place))].map((place) => { const people = TEAM.filter((p) => p.place === place); return { place, cc: people[0].cc, lon: people[0].lon, lat: people[0].lat, people }; }).sort((a, b) => b.lat - a.lat);
export const flag = (cc, w = 40) => `https://flagcdn.com/w${w}/${cc.toLowerCase()}.png`;
