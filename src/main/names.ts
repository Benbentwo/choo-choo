import { existsSync, readdirSync } from 'node:fs'
import * as git from './git'

// Conductor names worktrees after cities. We do the same. Names become folder and branch names, so plain
// lowercase ASCII only (see test/names.test.ts).
export const CITIES = [
  // Europe
  'aachen', 'aarhus', 'aberdeen', 'alicante', 'amsterdam', 'antwerp', 'athens', 'avignon', 'bari', 'basel',
  'bath', 'belfast', 'belgrade', 'bergamo', 'bergen', 'berlin', 'bern', 'bilbao', 'birmingham', 'bologna',
  'bonn', 'bordeaux', 'bratislava', 'bremen', 'brighton', 'bristol', 'brno', 'bruges', 'brussels', 'bucharest',
  'budapest', 'cadiz', 'cambridge', 'cannes', 'cardiff', 'catania', 'chamonix', 'cologne', 'copenhagen', 'cork',
  'dijon', 'dresden', 'dublin', 'dundee', 'edinburgh', 'eindhoven', 'florence', 'frankfurt', 'galway', 'gdansk',
  'geneva', 'genoa', 'ghent', 'glasgow', 'granada', 'graz', 'grenoble', 'hamburg', 'hanover', 'heidelberg',
  'helsinki', 'innsbruck', 'kyiv', 'kilkenny', 'krakow', 'lausanne', 'leeds', 'leiden', 'leipzig', 'lille',
  'limerick', 'lisbon', 'liverpool', 'ljubljana', 'london', 'lucerne', 'lugano', 'lyon', 'maastricht', 'madrid',
  'malaga', 'malmo', 'manchester', 'marseille', 'milan', 'minsk', 'monaco', 'montpellier', 'moscow', 'munich',
  'nantes', 'naples', 'nice', 'nuremberg', 'odessa', 'oporto', 'oslo', 'oxford', 'padua', 'palermo',
  'paris', 'parma', 'pisa', 'plymouth', 'porto', 'potsdam', 'poznan', 'prague', 'reims', 'riga',
  'rome', 'rotterdam', 'salzburg', 'sarajevo', 'seville', 'siena', 'skopje', 'sofia', 'split', 'stockholm',
  'strasbourg', 'stuttgart', 'tallinn', 'tampere', 'tartu', 'thessaloniki', 'tirana', 'toledo', 'toulouse', 'trieste',
  'trondheim', 'turin', 'turku', 'uppsala', 'utrecht', 'valencia', 'valletta', 'venice', 'verona', 'vienna',
  'vilnius', 'warsaw', 'wroclaw', 'york', 'zagreb', 'zaragoza', 'zurich',
  // Americas
  'albany', 'albuquerque', 'anchorage', 'arequipa', 'asheville', 'asuncion', 'atlanta', 'austin', 'baltimore', 'belem',
  'boise', 'bogota', 'boston', 'boulder', 'brasilia', 'buffalo', 'calgary', 'cali', 'cancun', 'caracas',
  'cartagena', 'charleston', 'charlotte', 'chicago', 'cincinnati', 'cleveland', 'columbus', 'cordoba', 'cuenca', 'cusco',
  'dallas', 'denver', 'detroit', 'durango', 'edmonton', 'fortaleza', 'guadalajara', 'halifax', 'havana', 'honolulu',
  'houston', 'indianapolis', 'juneau', 'kingston', 'lima', 'madison', 'managua', 'medellin', 'memphis', 'mendoza',
  'merida', 'miami', 'milwaukee', 'minneapolis', 'monterrey', 'montevideo', 'montreal', 'nashville', 'oakland', 'oaxaca',
  'omaha', 'orlando', 'ottawa', 'panama', 'philadelphia', 'phoenix', 'pittsburgh', 'portland', 'providence', 'puebla',
  'quebec', 'quito', 'raleigh', 'recife', 'regina', 'reno', 'richmond', 'rosario', 'sacramento', 'salvador',
  'santiago', 'savannah', 'seattle', 'spokane', 'tampa', 'toronto', 'tucson', 'tulsa', 'valparaiso', 'vancouver',
  'victoria', 'winnipeg',
  // Asia and the Middle East
  'agra', 'almaty', 'amman', 'baku', 'bangalore', 'bangkok', 'beijing', 'beirut', 'busan', 'cebu',
  'chennai', 'chengdu', 'chiangmai', 'colombo', 'daegu', 'dalian', 'davao', 'delhi', 'dhaka', 'doha',
  'dubai', 'fukuoka', 'goa', 'guangzhou', 'hangzhou', 'hanoi', 'harbin', 'hiroshima', 'hue', 'hyderabad',
  'incheon', 'istanbul', 'izmir', 'jaipur', 'jakarta', 'kanazawa', 'kathmandu', 'kobe', 'kochi', 'kolkata',
  'kunming', 'kyoto', 'lhasa', 'hoian', 'macau', 'manila', 'muscat', 'mumbai', 'mysore', 'nagasaki',
  'nagoya', 'nanjing', 'nara', 'osaka', 'penang', 'pune', 'qingdao', 'sapporo', 'seoul', 'sendai',
  'shanghai', 'shenzhen', 'singapore', 'suzhou', 'taipei', 'tainan', 'tashkent', 'tbilisi', 'tianjin', 'tokyo',
  'udaipur', 'ulaanbaatar', 'varanasi', 'xian', 'yerevan', 'yokohama',
  // Africa
  'abuja', 'accra', 'addis', 'agadir', 'alexandria', 'algiers', 'arusha', 'asmara', 'bamako', 'casablanca',
  'cairo', 'dakar', 'durban', 'essaouira', 'fez', 'gaborone', 'harare', 'kampala', 'khartoum', 'kigali',
  'kinshasa', 'lagos', 'luanda', 'lusaka', 'luxor', 'maputo', 'marrakech', 'mombasa', 'nairobi', 'niamey',
  'pretoria', 'rabat', 'tangier', 'tunis', 'windhoek', 'zanzibar',
  // Oceania
  'adelaide', 'auckland', 'brisbane', 'cairns', 'canberra', 'christchurch', 'darwin', 'dunedin', 'hobart', 'melbourne',
  'nadi', 'napier', 'nelson', 'perth', 'queenstown', 'rotorua', 'suva', 'sydney', 'wellington',
  // Smaller towns
  'antigua', 'arles', 'assisi', 'ayr', 'bayonne', 'biarritz', 'bled', 'bodo', 'bolzano', 'braga',
  'burgos', 'caen', 'calais', 'como', 'cuzco', 'delft', 'derry', 'dover', 'evora', 'faro',
  'gothenburg', 'haarlem', 'inverness', 'kotor', 'lecce', 'leon', 'lucca', 'lund', 'modena', 'mostar',
  'nimes', 'orvieto', 'oviedo', 'perugia', 'pula', 'ravenna', 'ronda', 'rouen', 'salamanca', 'segovia',
  'sintra', 'stirling', 'tours', 'umea', 'vigo', 'visby', 'zadar', 'bend', 'eugene', 'fresno',
  'helena', 'irvine', 'laredo', 'macon', 'missoula', 'moab', 'ogden', 'pasadena', 'salem', 'santafe',
  'sedona', 'taos', 'tacoma', 'yuma', 'ubud', 'hakone', 'matsue', 'nikko', 'otaru', 'beppu',
  'kandy', 'galle', 'hampi', 'leh', 'ooty', 'shimla', 'haifa', 'petra', 'jaffa', 'byblos',
  // Islands and the far north
  'reykjavik', 'nuuk', 'tromso', 'torshavn', 'akureyri', 'hamilton', 'nassau', 'bridgetown', 'papeete', 'apia'
]

export function pickCityName(taken: Set<string>, rand: () => number = Math.random): string {
  const free = CITIES.filter((c) => !taken.has(c))
  if (free.length > 0) return free[Math.floor(rand() * free.length)]
  for (let n = 2; ; n++) {
    const base = CITIES[Math.floor(rand() * CITIES.length)]
    if (!taken.has(`${base}-${n}`)) return `${base}-${n}`
  }
}

/**
 * Names a new workspace can't use: ones the store already has, folders already in the workspaces folder,
 * and `<prefix>/<name>` branches left behind locally or on origin (a deleted workspace keeps its branch,
 * so `git worktree add -b` would fail on it).
 */
export async function namesInUse(repoPath: string, dir: string, storeNames: Iterable<string>, prefix: string): Promise<Set<string>> {
  const taken = new Set(storeNames)
  for (const b of await git.branchesUnder(repoPath, prefix)) taken.add(b)
  if (existsSync(dir)) for (const f of readdirSync(dir)) taken.add(f)
  return taken
}
