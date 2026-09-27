// Copied from arena-tracker src/lib/regions.js
export const REGIONS = [
  { label: 'NA', platform: 'na1', cluster: 'americas' },
  { label: 'EUW', platform: 'euw1', cluster: 'europe' },
  { label: 'KR', platform: 'kr', cluster: 'asia' },
  { label: 'EUNE', platform: 'eun1', cluster: 'europe' },
  { label: 'BR', platform: 'br1', cluster: 'americas' },
  { label: 'LAN', platform: 'la1', cluster: 'americas' },
  { label: 'LAS', platform: 'la2', cluster: 'americas' },
  { label: 'OCE', platform: 'oc1', cluster: 'americas' },
  { label: 'TR', platform: 'tr1', cluster: 'europe' },
  { label: 'RU', platform: 'ru', cluster: 'europe' },
  { label: 'JP', platform: 'jp1', cluster: 'asia' },
];

export const regionByLabel = (label: string) =>
  REGIONS.find((r) => r.label === label.toUpperCase()) || REGIONS[0];
