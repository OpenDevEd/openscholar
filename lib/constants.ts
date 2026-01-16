import { YearRangePreset } from "./types";

export const ITEMS_PER_PAGE = 20;

export const sortOptions = [
  { value: "relevance_score:desc", label: "Relevance (Most Relevant)" },
  { value: "cited_by_count:desc", label: "Citations (Most Cited)" },
  { value: "cited_by_count:asc", label: "Citations (Least Cited)" },
  { value: "publication_date:desc", label: "Publication Date (Newest)" },
  { value: "publication_date:asc", label: "Publication Date (Oldest)" },
  { value: "display_name:desc", label: "Title (Z-A)" },
  { value: "display_name:asc", label: "Title (A-Z)" },
] as const;

export const DEFAULT_YEAR_RANGE: [number, number] = [2020, new Date().getFullYear()];
export const MIN_YEAR = 1900;

export const getYearRangePresets = (): YearRangePreset[] => {
  const currentYear = new Date().getFullYear();
  return [
    { label: "This Year", range: [currentYear, currentYear] as [number, number] },
    { label: "Last Year", range: [currentYear - 1, currentYear - 1] as [number, number] },
    { label: "Last 5 Years", range: [currentYear - 5, currentYear] as [number, number] },
    { label: "Last 10 Years", range: [currentYear - 10, currentYear] as [number, number] },
    { label: "Last 15 Years", range: [currentYear - 15, currentYear] as [number, number] },
    { label: "Last 20 Years", range: [currentYear - 20, currentYear] as [number, number] },
  ];
}; 

type Entry = {
	label: string;
	children?: Entry[];
}

export const COUNTRIES: Record<string, string> = {
	AF: 'Afghanistan',
	AL: 'Albania',
	DZ: 'Algeria',
	AS: 'American Samoa',
	AD: 'Andorra',
	AO: 'Angola',
	AI: 'Anguilla',
	AQ: 'Antarctica',
	AG: 'Antigua and Barbuda',
	AR: 'Argentina',
	AM: 'Armenia',
	AW: 'Aruba',
	AU: 'Australia',
	AT: 'Austria',
	AZ: 'Azerbaijan',
	BS: 'Bahamas',
	BH: 'Bahrain',
	BD: 'Bangladesh',
	BB: 'Barbados',
	BY: 'Belarus',
	BE: 'Belgium',
	BZ: 'Belize',
	BJ: 'Benin',
	BM: 'Bermuda',
	BT: 'Bhutan',
	BO: 'Bolivia',
	BQ: 'Bonaire',
	BA: 'Bosnia and Herzegovina',
	BW: 'Botswana',
	BV: 'Bouvet Island',
	BR: 'Brazil',
	IO: 'British Indian Ocean Territory',
	BN: 'Brunei Darussalam',
	BG: 'Bulgaria',
	BF: 'Burkina Faso',
	BI: 'Burundi',
	KH: 'Cambodia',
	CM: 'Cameroon',
	CA: 'Canada',
	CV: 'Cape Verde',
	KY: 'Cayman Islands',
	CF: 'Central African Republic',
	TD: 'Chad',
	CL: 'Chile',
	CN: 'China',
	CX: 'Christmas Island',
	CC: 'Cocos (Keeling) Islands',
	CO: 'Colombia',
	KM: 'Comoros',
	CG: 'Congo',
	CD: 'Congo, The Democratic Republic of the',
	CK: 'Cook Islands',
	CR: 'Costa Rica',
	CI: 'Cote d\'Ivoire / Ivory Coast',
	HR: 'Croatia',
	CU: 'Cuba',
	CW: 'Curacao',
	CY: 'Cyprus',
	CZ: 'Czech Republic',
	DK: 'Denmark',
	DJ: 'Djibouti',
	DM: 'Dominica',
	DO: 'Dominican Republic',
	EC: 'Ecuador',
	EG: 'Egypt',
	SV: 'El Salvador',
	GQ: 'Equatorial Guinea',
	ER: 'Eritrea',
	EE: 'Estonia',
	SZ: 'Eswatini / Swaziland',
	ET: 'Ethiopia',
	FK: 'Falkland Islands (Malvinas)',
	FO: 'Faroe Islands',
	FJ: 'Fiji',
	FI: 'Finland',
	FR: 'France',
	GF: 'French Guiana',
	PF: 'French Polynesia',
	TF: 'French Southern Territories',
	GA: 'Gabon',
	GM: 'Gambia',
	GE: 'Georgia',
	DE: 'Germany',
	GH: 'Ghana',
	GI: 'Gibraltar',
	GR: 'Greece',
	GL: 'Greenland',
	GD: 'Grenada',
	GP: 'Guadeloupe',
	GU: 'Guam',
	GT: 'Guatemala',
	GG: 'Guernsey',
	GN: 'Guinea',
	GW: 'Guinea-Bissau',
	GY: 'Guyana',
	HT: 'Haiti',
	HM: 'Heard Island and Mcdonald Islands',
	VA: 'Holy See (Vatican City State)',
	HN: 'Honduras',
	HK: 'Hong Kong',
	HU: 'Hungary',
	IS: 'Iceland',
	IN: 'India',
	ID: 'Indonesia',
	IR: 'Iran, Islamic Republic of',
	IQ: 'Iraq',
	IE: 'Ireland',
	IM: 'Isle of Man',
	IL: 'Israel',
	IT: 'Italy',
	JM: 'Jamaica',
	JP: 'Japan',
	JE: 'Jersey',
	JO: 'Jordan',
	KZ: 'Kazakhstan',
	KE: 'Kenya',
	KI: 'Kiribati',
	KP: "Korea, Democratic People's Republic of",
	KR: 'Korea, Republic of',
	KW: 'Kuwait',
	KG: 'Kyrgyzstan',
	LA: "Lao People's Democratic Republic",
	LV: 'Latvia',
	LB: 'Lebanon',
	LS: 'Lesotho',
	LR: 'Liberia',
	LY: 'Libyan Arab Jamahiriya',
	LI: 'Liechtenstein',
	LT: 'Lithuania',
	LU: 'Luxembourg',
	MO: 'Macao',
	MK: 'Macedonia, The Republic of North',
	MG: 'Madagascar',
	MW: 'Malawi',
	MY: 'Malaysia',
	MV: 'Maldives',
	ML: 'Mali',
	MT: 'Malta',
	MH: 'Marshall Islands',
	MQ: 'Martinique',
	MR: 'Mauritania',
	MU: 'Mauritius',
	YT: 'Mayotte',
	MX: 'Mexico',
	FM: 'Micronesia, Federated States of',
	MD: 'Moldova, Republic of',
	MC: 'Monaco',
	MN: 'Mongolia',
	ME: 'Montenegro',
	MS: 'Montserrat',
	MA: 'Morocco',
	MZ: 'Mozambique',
	MM: 'Myanmar',
	NA: 'Namibia',
	NR: 'Nauru',
	NP: 'Nepal',
	NL: 'Netherlands',
	AN: 'Netherlands Antilles',
	NC: 'New Caledonia',
	NZ: 'New Zealand',
	NI: 'Nicaragua',
	NE: 'Niger',
	NG: 'Nigeria',
	NU: 'Niue',
	NF: 'Norfolk Island',
	MP: 'Northern Mariana Islands',
	NO: 'Norway',
	OM: 'Oman',
	PK: 'Pakistan',
	PW: 'Palau',
	PS: 'Palestine',
	PA: 'Panama',
	PG: 'Papua New Guinea',
	PY: 'Paraguay',
	PE: 'Peru',
	PH: 'Philippines',
	PN: 'Pitcairn',
	PL: 'Poland',
	PT: 'Portugal',
	PR: 'Puerto Rico',
	QA: 'Qatar',
	RW: 'Rwanda',
	RE: 'Reunion',
	RO: 'Romania',
	RU: 'Russian Federation',
	BL: 'Saint Barthelemy',
	SH: 'Saint Helena',
	KN: 'Saint Kitts and Nevis',
	LC: 'Saint Lucia',
	MF: 'Saint Martin',
	PM: 'Saint Pierre and Miquelon',
	VC: 'Saint Vincent and the Grenadines',
	WS: 'Samoa',
	SM: 'San Marino',
	ST: 'Sao Tome and Principe',
	SA: 'Saudi Arabia',
	SN: 'Senegal',
	RS: 'Serbia',
	SC: 'Seychelles',
	SL: 'Sierra Leone',
	SG: 'Singapore',
	SX: 'Sint Maarten',
	SK: 'Slovakia',
	SI: 'Slovenia',
	SB: 'Solomon Islands',
	SO: 'Somalia',
	ZA: 'South Africa',
	GS: 'South Georgia and the South Sandwich Islands',
	SS: 'South Sudan',
	ES: 'Spain',
	LK: 'Sri Lanka',
	SD: 'Sudan',
	SR: 'Suriname',
	SJ: 'Svalbard and Jan Mayen',
	SE: 'Sweden',
	CH: 'Switzerland',
	SY: 'Syrian Arab Republic',
	TW: 'Taiwan',
	TJ: 'Tajikistan',
	TZ: 'Tanzania, United Republic of',
	TH: 'Thailand',
	TL: 'Timor-Leste',
	TG: 'Togo',
	TK: 'Tokelau',
	TO: 'Tonga',
	TT: 'Trinidad and Tobago',
	TN: 'Tunisia',
	TR: 'Turkey',
	TM: 'Turkmenistan',
	TC: 'Turks and Caicos Islands',
	TV: 'Tuvalu',
	UG: 'Uganda',
	UA: 'Ukraine',
	AE: 'United Arab Emirates',
	GB: 'United Kingdom',
	US: 'United States',
	UM: 'United States Minor Outlying Islands',
	UY: 'Uruguay',
	UZ: 'Uzbekistan',
	VU: 'Vanuatu',
	VE: 'Venezuela',
	VN: 'Viet Nam',
	VG: 'Virgin Islands, British',
	VI: 'Virgin Islands, U.S.',
	WF: 'Wallis and Futuna',
	EH: 'Western Sahara',
	YE: 'Yemen',
	ZM: 'Zambia',
	ZW: 'Zimbabwe',
	AX: 'Åland Islands',
	XK: "Kosovo"
};

export const COUNTRY_HIERARCHY: Entry = {
	label: "World",
	children: [
		{
			label: "Africa",
			children: [
				{
					label: "Eastern Africa",
					children: [
						{ label: "BI" }, // Burundi
						{ label: "KM" }, // Comoros
						{ label: "DJ" }, // Djibouti
						{ label: "ER" }, // Eritrea
						{ label: "ET" }, // Ethiopia
						{ label: "IO" }, // British Indian Ocean Territory (Added)
						{ label: "KE" }, // Kenya
						{ label: "MG" }, // Madagascar
						{ label: "MW" }, // Malawi
						{ label: "MU" }, // Mauritius
						{ label: "YT" }, // Mayotte
						{ label: "MZ" }, // Mozambique
						{ label: "RE" }, // Reunion
						{ label: "RW" }, // Rwanda
						{ label: "SC" }, // Seychelles
						{ label: "SO" }, // Somalia
						{ label: "SS" }, // South Sudan
						{ label: "TZ" }, // Tanzania
						{ label: "UG" }, // Uganda
						{ label: "ZM" }, // Zambia
						{ label: "ZW" }, // Zimbabwe
					],
				},
				{
					label: "Middle Africa",
					children: [
						{ label: "AO" }, // Angola
						{ label: "CM" }, // Cameroon
						{ label: "CF" }, // Central African Republic
						{ label: "TD" }, // Chad
						{ label: "CG" }, // Congo
						{ label: "CD" }, // Congo, Democratic Republic of the
						{ label: "GQ" }, // Equatorial Guinea
						{ label: "GA" }, // Gabon
						{ label: "ST" }, // Sao Tome and Principe
					],
				},
				{
					label: "Northern Africa",
					children: [
						{ label: "DZ" }, // Algeria
						{ label: "EG" }, // Egypt
						{ label: "LY" }, // Libyan Arab Jamahiriya
						{ label: "MA" }, // Morocco
						{ label: "SD" }, // Sudan
						{ label: "TN" }, // Tunisia
						{ label: "EH" }, // Western Sahara
					],
				},
				{
					label: "Southern Africa",
					children: [
						{ label: "BW" }, // Botswana
						{ label: "SZ" }, // Eswatini / Swaziland
						{ label: "LS" }, // Lesotho
						{ label: "NA" }, // Namibia
						{ label: "ZA" }, // South Africa
					],
				},
				{
					label: "Western Africa",
					children: [
						{ label: "BJ" }, // Benin
						{ label: "BF" }, // Burkina Faso
						{ label: "CV" }, // Cape Verde
						{ label: "CI" }, // Cote d'Ivoire / Ivory Coast
						{ label: "GM" }, // Gambia
						{ label: "GH" }, // Ghana
						{ label: "GN" }, // Guinea
						{ label: "GW" }, // Guinea-Bissau
						{ label: "LR" }, // Liberia
						{ label: "ML" }, // Mali
						{ label: "MR" }, // Mauritania
						{ label: "NE" }, // Niger
						{ label: "NG" }, // Nigeria
						{ label: "SH" }, // Saint Helena
						{ label: "SN" }, // Senegal
						{ label: "SL" }, // Sierra Leone
						{ label: "TG" }, // Togo
					],
				},
			],
		},
		{
			label: "Americas",
			children: [
				{
					label: "Caribbean",
					children: [
						{ label: "AI" }, // Anguilla
						{ label: "AG" }, // Antigua and Barbuda
						{ label: "AW" }, // Aruba
						{ label: "BS" }, // Bahamas
						{ label: "BB" }, // Barbados
						{ label: "BQ" }, // Bonaire
						{ label: "VG" }, // British Virgin Islands
						{ label: "KY" }, // Cayman Islands
						{ label: "CU" }, // Cuba
						{ label: "CW" }, // Curacao
						{ label: "DM" }, // Dominica
						{ label: "DO" }, // Dominican Republic
						{ label: "GD" }, // Grenada
						{ label: "GP" }, // Guadeloupe
						{ label: "HT" }, // Haiti
						{ label: "JM" }, // Jamaica
						{ label: "MQ" }, // Martinique
						{ label: "MS" }, // Montserrat
						{ label: "AN" }, // Netherlands Antilles (Added - Dissolved)
						{ label: "PR" }, // Puerto Rico
						{ label: "BL" }, // Saint Barthelemy
						{ label: "KN" }, // Saint Kitts and Nevis
						{ label: "LC" }, // Saint Lucia
						{ label: "MF" }, // Saint Martin
						{ label: "PM" }, // Saint Pierre and Miquelon
						{ label: "VC" }, // Saint Vincent and the Grenadines
						{ label: "SX" }, // Sint Maarten
						{ label: "TT" }, // Trinidad and Tobago
						{ label: "TC" }, // Turks and Caicos Islands
						{ label: "VI" }, // U.S. Virgin Islands
					]
				},
				{
					label: "Central America",
					children: [
						{ label: "BZ" }, // Belize
						{ label: "CR" }, // Costa Rica
						{ label: "SV" }, // El Salvador
						{ label: "GT" }, // Guatemala
						{ label: "HN" }, // Honduras
						{ label: "MX" }, // Mexico
						{ label: "NI" }, // Nicaragua
						{ label: "PA" }, // Panama
					]
				},
				{
					label: "North America",
					children: [
						{ label: "BM" }, // Bermuda
						{ label: "CA" }, // Canada
						{ label: "GL" }, // Greenland
						{ label: "US" }, // United States
						{ label: "UM" } // United States Minor Outlying Islands
					]
				},
				{
					label: "South America",
					children: [
						{ label: "AR" }, // Argentina
						{ label: "BO" }, // Bolivia
						{ label: "BR" }, // Brazil
						{ label: "CL" }, // Chile
						{ label: "CO" }, // Colombia
						{ label: "EC" }, // Ecuador
						{ label: "FK" }, // Falkland Islands (Malvinas)
						{ label: "GF" }, // French Guiana
						{ label: "GY" }, // Guyana
						{ label: "PY" }, // Paraguay
						{ label: "PE" }, // Peru
						{ label: "SR" }, // Suriname
						{ label: "UY" }, // Uruguay
						{ label: "VE" }, // Venezuela
					]
				}
			]
		},
		{
			label: "Asia",
			children: [
				{
					label: "Central Asia",
					children: [
						{ label: "KZ" }, // Kazakhstan
						{ label: "KG" }, // Kyrgyzstan
						{ label: "TJ" }, // Tajikistan
						{ label: "TM" }, // Turkmenistan
						{ label: "UZ" }, // Uzbekistan
					]
				},
				{
					label: "Eastern Asia",
					children: [
						{ label: "CN" }, // China
						{ label: "HK" }, // Hong Kong
						{ label: "JP" }, // Japan
						{ label: "KP" }, // Korea, Democratic People's Republic of
						{ label: "KR" }, // Korea, Republic of
						{ label: "MO" }, // Macao
						{ label: "MN" }, // Mongolia
						{ label: "TW" }, // Taiwan
					]
				},
				{
					label: "South-Eastern Asia",
					children: [
						{ label: "BN" }, // Brunei Darussalam
						{ label: "KH" }, // Cambodia
						{ label: "ID" }, // Indonesia
						{ label: "LA" }, // Lao People's Democratic Republic
						{ label: "MY" }, // Malaysia
						{ label: "MM" }, // Myanmar
						{ label: "PH" }, // Philippines
						{ label: "SG" }, // Singapore
						{ label: "TH" }, // Thailand
						{ label: "TL" }, // Timor-Leste
						{ label: "VN" }, // Viet Nam
					]
				},
				{
					label: "Southern Asia",
					children: [
						{ label: "AF" }, // Afghanistan
						{ label: "BD" }, // Bangladesh
						{ label: "BT" }, // Bhutan
						{ label: "IN" }, // India
						{ label: "IR" }, // Iran, Islamic Republic of
						{ label: "MV" }, // Maldives
						{ label: "NP" }, // Nepal
						{ label: "PK" }, // Pakistan
						{ label: "LK" }, // Sri Lanka
					]
				},
				{
					label: "Western Asia",
					children: [
						{ label: "AM" }, // Armenia
						{ label: "AZ" }, // Azerbaijan
						{ label: "BH" }, // Bahrain
						{ label: "CY" }, // Cyprus
						{ label: "GE" }, // Georgia
						{ label: "IQ" }, // Iraq
						{ label: "IL" }, // Israel
						{ label: "JO" }, // Jordan
						{ label: "KW" }, // Kuwait
						{ label: "LB" }, // Lebanon
						{ label: "OM" }, // Oman
						{ label: "PS" }, // Palestine
						{ label: "QA" }, // Qatar
						{ label: "SA" }, // Saudi Arabia
						{ label: "SY" }, // Syrian Arab Republic
						{ label: "TR" }, // Turkey
						{ label: "AE" }, // United Arab Emirates
						{ label: "YE" }, // Yemen
					]
				}
			]
		},
		{
			label: "Europe",
			children: [
				{
					label: "Eastern Europe",
					children: [
						{ label: "BY" }, // Belarus
						{ label: "BG" }, // Bulgaria
						{ label: "CZ" }, // Czech Republic
						{ label: "HU" }, // Hungary
						{ label: "MD" }, // Moldova, Republic of
						{ label: "PL" }, // Poland
						{ label: "RO" }, // Romania
						{ label: "RU" }, // Russian Federation
						{ label: "SK" }, // Slovakia
						{ label: "UA" }, // Ukraine
					]
				},
				{
					label: "Northern Europe",
					children: [
						{ label: "AX" }, // Åland Islands
						{ label: "DK" }, // Denmark
						{ label: "EE" }, // Estonia
						{ label: "FO" }, // Faroe Islands
						{ label: "FI" }, // Finland
						{ label: "GG" }, // Guernsey
						{ label: "IS" }, // Iceland
						{ label: "IE" }, // Ireland
						{ label: "IM" }, // Isle of Man
						{ label: "JE" }, // Jersey
						{ label: "LV" }, // Latvia
						{ label: "LT" }, // Lithuania
						{ label: "NO" }, // Norway
						{ label: "SJ" }, // Svalbard and Jan Mayen
						{ label: "SE" }, // Sweden
						{ label: 'GB' } // United Kingdom
					]
				},
				{
					label: "Southern Europe",
					children: [
						{ label: "AL" }, // Albania
						{ label: "AD" }, // Andorra
						{ label: "BA" }, // Bosnia and Herzegovina
						{ label: "HR" }, // Croatia
						{ label: "GI" }, // Gibraltar
						{ label: "GR" }, // Greece
						{ label: "VA" }, // Holy See (Vatican City State)
						{ label: "IT" }, // Italy
						{ label: "MT" }, // Malta
						{ label: "ME" }, // Montenegro
						{ label: "PT" }, // Portugal
						{ label: "SM" }, // San Marino
						{ label: "RS" }, // Serbia
						{ label: "SI" }, // Slovenia
						{ label: "ES" }, // Spain
						{ label: "MK" }, // Macedonia, The Republic of North
						{ label: "XK" } // Kosovo
					]
				},
				{
					label: "Western Europe",
					children: [
						{ label: "AT" }, // Austria
						{ label: "BE" }, // Belgium
						{ label: "FR" }, // France
						{ label: "DE" }, // Germany
						{ label: "LI" }, // Liechtenstein
						{ label: "LU" }, // Luxembourg
						{ label: "MC" }, // Monaco
						{ label: "NL" }, // Netherlands
						{ label: "CH" }, // Switzerland
					]
				}
			]
		},
		{
			label: "Oceania",
			children: [
				{
					label: "Australia and New Zealand",
					children: [
						{ label: "AU" }, // Australia
						{ label: "CX" }, // Christmas Island
						{ label: "CC" }, // Cocos (Keeling) Islands
						{ label: "HM" }, // Heard Island and Mcdonald Islands
						{ label: "NF" }, // Norfolk Island
						{ label: "NZ" }, // New Zealand
					]
				},
				{
					label: "Melanesia",
					children: [
						{ label: "FJ" }, // Fiji
						{ label: "NC" }, // New Caledonia
						{ label: "PG" }, // Papua New Guinea
						{ label: "SB" }, // Solomon Islands
						{ label: "VU" }, // Vanuatu
					]
				},
				{
					label: "Micronesia",
					children: [
						{ label: "GU" }, // Guam
						{ label: "KI" }, // Kiribati
						{ label: "MH" }, // Marshall Islands
						{ label: "FM" }, // Micronesia, Federated States of
						{ label: "NR" }, // Nauru
						{ label: "MP" }, // Northern Mariana Islands
						{ label: "PW" }, // Palau
					]
				},
				{
					label: "Polynesia",
					children: [
						{ label: "AS" }, // American Samoa
						{ label: "CK" }, // Cook Islands
						{ label: "PF" }, // French Polynesia
						{ label: "NU" }, // Niue
						{ label: "PN" }, // Pitcairn
						{ label: "WS" }, // Samoa
						{ label: "TK" }, // Tokelau
						{ label: "TO" }, // Tonga
						{ label: "TV" }, // Tuvalu
						{ label: "WF" }, // Wallis and Futuna
					]
				}
			]
		},
		{
			label: "Antarctica",
			children: [{
				label: "Antarctica", // Note: This intermediate label might be redundant
				children: [
					{ label: "AQ" }, // Antarctica
					{ label: "BV" }, // Bouvet Island
					{ label: "TF" }, // French Southern Territories
					{ label: "GS" } // South Georgia and the South Sandwich Islands
				]
			}]
		}
	],
};

/**
 * Recursively extract all country codes from a region entry
 */
function getCountriesFromRegion(entry: Entry): string[] {
  const countries: string[] = [];
  
  if (entry.children) {
    entry.children.forEach(child => {
      countries.push(...getCountriesFromRegion(child));
    });
  } else {
    // If no children, this is a leaf node (country)
    countries.push(entry.label);
  }
  
  return countries;
}

/**
 * Create a mapping from region IDs to their country codes
 */
function createRegionToCountriesMap(): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  
  function processEntry(entry: Entry, path: string[] = []) {
    const currentId = entry.label.toLowerCase().replace(/\s+/g, '_');
    const fullPath = [...path, currentId];
    
    if (entry.children && entry.children.length > 0) {
      // This is a region - add mapping for this region
      const countries = getCountriesFromRegion(entry);
      map[currentId] = countries;
      
      // Process children
      entry.children.forEach(child => {
        processEntry(child, fullPath);
      });
    }
  }
  
  processEntry(COUNTRY_HIERARCHY);
  return map;
}

// Pre-compute the region to countries mapping
const REGION_TO_COUNTRIES_MAP = createRegionToCountriesMap();

/**
 * Get country codes for multiple regions and individual countries, handling overlaps properly
 * Returns an object with countries array and a warning if limit exceeded
 */
export function getCountryCodesForRegions(regionIds: string[], bypassLimit = false): {
  countries: string[];
  isLimitExceeded: boolean;
  totalCount: number;
} {
  const allCountries = new Set<string>();
  
  regionIds.forEach(regionId => {
    // Check if this is an individual country code (2-letter)
    if (regionId.length === 2 && COUNTRIES[regionId]) {
      // This is a direct country code
      allCountries.add(regionId);
    } else {
      // This is a region - get all countries from the region
      const countries = REGION_TO_COUNTRIES_MAP[regionId] || [];
      countries.forEach(country => allCountries.add(country));
    }
  });
  
  const countriesArray = Array.from(allCountries);
  const MAX_COUNTRIES = 100;
  
  // Apply limit only if not bypassed (Institution location needs limit, Country focus doesn't)
  if (bypassLimit) {
    return {
      countries: countriesArray,
      isLimitExceeded: false,
      totalCount: countriesArray.length
    };
  }
  
  return {
    countries: countriesArray.slice(0, MAX_COUNTRIES),
    isLimitExceeded: countriesArray.length > MAX_COUNTRIES,
    totalCount: countriesArray.length
  };
}