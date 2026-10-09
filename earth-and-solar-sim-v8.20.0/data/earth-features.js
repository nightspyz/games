// The real places the Earth's special features stand at: [name, latitude, longitude, ...]. Hand-made; the heights and the dates are common knowledge.
// volcanoes: [name, lat, lon, summit in real metres, active (lava and bombs) or sleeping (a mountain with a crater)]
// temples: ancient and sacred sites; rigs: oil and gas fields at sea; winds: [name, lat, lon, offshore]
const EARTH_FEATURES = {
  volcanoes: [
    ["Mount Fuji", 35.36, 138.73, 3776, 0], ["Etna", 37.75, 14.99, 3329, 1], ["Vesuvius", 40.82, 14.43, 1281, 0], ["Stromboli", 38.79, 15.21, 924, 1], ["Kilauea", 19.42, -155.29, 1247, 1],
    ["Mauna Loa", 19.48, -155.6, 4169, 1], ["Popocatepetl", 19.02, -98.62, 5426, 1], ["Eyjafjallajokull", 63.63, -19.62, 1651, 1], ["Hekla", 63.99, -19.67, 1491, 1], ["Krakatau", -6.1, 105.42, 813, 1],
    ["Merapi", -7.54, 110.44, 2910, 1], ["Pinatubo", 15.13, 120.35, 1486, 0], ["Mayon", 13.26, 123.69, 2462, 1], ["Taal", 14.0, 120.99, 311, 1], ["Mount St Helens", 46.2, -122.19, 2549, 0],
    ["Mount Rainier", 46.85, -121.76, 4392, 0], ["Cotopaxi", -0.68, -78.44, 5897, 1], ["Villarrica", -39.42, -71.94, 2847, 1], ["Nyiragongo", -1.52, 29.25, 3470, 1], ["Ol Doinyo Lengai", -2.76, 35.91, 2962, 1],
    ["Erebus", -77.53, 167.15, 3794, 1], ["Teide", 28.27, -16.64, 3718, 0], ["Sakurajima", 31.58, 130.66, 1117, 1], ["Aso", 32.88, 131.1, 1592, 1], ["Santorini", 36.4, 25.4, 367, 0],
    ["Ruapehu", -39.28, 175.57, 2797, 1], ["Yasur", -19.53, 169.45, 361, 1], ["Soufriere Hills", 16.72, -62.18, 915, 1], ["Arenal", 10.46, -84.7, 1670, 1], ["Klyuchevskaya", 56.06, 160.64, 4750, 1],
    ["Mount Pelee", 14.82, -61.17, 1397, 0], ["Mount Cameroon", 4.2, 9.17, 4040, 1], ["Mount Kenya", -0.15, 37.31, 5199, 0], ["Kilimanjaro", -3.07, 37.35, 5895, 0], ["Ararat", 39.7, 44.3, 5137, 0],
    ["Demavend", 35.95, 52.11, 5610, 0], ["Chimborazo", -1.47, -78.82, 6263, 0], ["Ojos del Salado", -27.11, -68.54, 6893, 0], ["Mount Baker", 48.78, -121.81, 3286, 0], ["Katmai", 58.28, -154.96, 2047, 1],
    ["Sinabung", 3.17, 98.39, 2460, 1], ["Bromo", -7.94, 112.95, 2329, 1], ["Rinjani", -8.41, 116.47, 3726, 1], ["Tambora", -8.25, 118.0, 2850, 0], ["Ambrym", -16.25, 168.12, 1334, 1],
    ["White Island", -37.52, 177.18, 321, 1], ["Taranaki", -39.3, 174.06, 2518, 0], ["Piton de la Fournaise", -21.24, 55.71, 2632, 1], ["Fuego", 14.47, -90.88, 3763, 1], ["Masaya", 11.98, -86.17, 635, 1],
  ],
  temples: [
    ["Angkor Wat", 13.41, 103.87], ["Borobudur", -7.61, 110.2], ["Machu Picchu", -13.16, -72.55], ["Giza", 29.98, 31.13], ["Parthenon", 37.97, 23.73], ["Stonehenge", 51.18, -1.83], ["Petra", 30.33, 35.44],
    ["Chichen Itza", 20.68, -88.57], ["Teotihuacan", 19.69, -98.84], ["Taj Mahal", 27.17, 78.04], ["Ise Shrine", 34.46, 136.72], ["Todai-ji", 34.69, 135.84], ["Bagan", 21.17, 94.86], ["Karnak", 25.72, 32.66],
    ["Tikal", 17.22, -89.62], ["Meenakshi Temple", 9.92, 78.12], ["Temple of Heaven", 39.88, 116.41], ["Pagan Shwezigon", 21.2, 94.88], ["Delphi", 38.48, 22.5], ["Baalbek", 34.0, 36.2],
    ["Abu Simbel", 22.34, 31.63], ["Pura Besakih", -8.37, 115.45], ["Prambanan", -7.75, 110.49], ["Wat Arun", 13.74, 100.49], ["Kinkaku-ji", 35.04, 135.73], ["Machu Picchu South", -13.2, -72.5],
  ],
  rigs: [
    ["Brent field", 61.05, 1.7], ["Ekofisk", 56.55, 3.2], ["Forties", 57.7, 0.95], ["Gulf of Mexico: Mars", 28.17, -89.2], ["Gulf of Mexico: Perdido", 26.1, -94.9], ["Gulf of Mexico: Atlantis", 27.2, -90.0],
    ["Ghawar offshore: Safaniya", 28.2, 48.8], ["Persian Gulf: South Pars", 26.9, 52.2], ["Campos Basin", -22.5, -40.0], ["Santos Basin", -25.1, -43.2], ["Baku: Azeri-Chirag", 40.0, 51.3],
    ["Niger Delta offshore", 4.0, 6.0], ["Angola: Block 17", -7.8, 11.9], ["Sakhalin", 53.6, 143.2], ["North West Shelf", -19.7, 115.9], ["Gulf of Suez", 28.2, 33.1], ["Malaysia: Sarawak", 5.3, 111.5],
    ["Hibernia", 46.75, -48.8], ["Alaska: Cook Inlet", 60.8, -151.6], ["Venezuela: Lake Maracaibo mouth", 11.1, -71.5],
  ],
  winds: [
    ["Roscoe, Texas", 32.45, -100.55, 0], ["Altamont Pass", 37.74, -121.65, 0], ["Tehachapi", 35.08, -118.3, 0], ["Jaisalmer", 26.9, 70.9, 0], ["Jiuquan, Gansu", 40.1, 96.3, 0], ["Zhangbei", 41.15, 114.7, 0],
    ["Navarra", 42.7, -1.7, 0], ["Whitelee, Scotland", 55.68, -4.3, 0], ["Isthmus of Tehuantepec", 16.5, -94.8, 0], ["Rio Grande do Norte", -5.5, -36.0, 0], ["Macarthur, Victoria", -38.0, 142.2, 0],
    ["Wellington", -41.3, 174.7, 0], ["Hornsea", 53.88, 1.8, 1], ["Horns Rev", 55.5, 7.85, 1], ["Walney", 54.05, -3.5, 1], ["Gemini", 54.04, 5.96, 1], ["London Array", 51.64, 1.5, 1], ["Rudong", 32.5, 121.5, 1],
    ["Anholt", 56.6, 11.2, 1], ["Jutland coast", 56.4, 8.1, 0], ["Patagonia: Rawson", -43.3, -65.1, 0], ["Hokkaido", 43.0, 141.3, 0],
  ],
};

// landmarks: [name, lat, lon, model, size (1 = the model's own size), turn in degrees]; the models are in js/77-landmarks.js
EARTH_FEATURES.landmarks = [
  ["Eiffel Tower", 48.8584, 2.2945, "lattice", 1.0, 0], ["Arc de Triomphe", 48.8738, 2.295, "arch", 1.0, 0], ["Notre-Dame", 48.853, 2.3499, "cathedral", 1.0, 0], ["Louvre Pyramid", 48.8606, 2.3376, "glasspyramid", 1.0, 0],
  ["Dome of the Rock", 31.7781, 35.2354, "goldendome", 1.0, 0], ["Western Wall", 31.7767, 35.2345, "wall", 0.6, 0], ["Church of the Holy Sepulchre", 31.7784, 35.2296, "cathedral", 0.6, 0], ["Tower of David", 31.7767, 35.2279, "keep", 0.8, 0],
  ["Masada", 31.3156, 35.3536, "ruinfort", 1.0, 20], ["Azrieli Towers, Tel Aviv", 32.0743, 34.7922, "threetowers", 1.0, 0], ["Jaffa Clock Tower", 32.0536, 34.7524, "clocktower", 0.6, 0], ["Bahai Gardens, Haifa", 32.8147, 34.9873, "terracedome", 1.0, 0],
  ["Big Ben", 51.5007, -0.1246, "clocktower", 1.0, 0], ["Tower Bridge", 51.5055, -0.0754, "towerbridge", 1.0, 90], ["London Eye", 51.5033, -0.1196, "wheel", 1.0, 0], ["The Shard", 51.5045, -0.0865, "spire", 0.9, 0],
  ["Colosseum", 41.8902, 12.4922, "colosseum", 1.0, 0], ["St Peter's Basilica", 41.9022, 12.4539, "bigdome", 1.0, 0], ["Leaning Tower of Pisa", 43.723, 10.3966, "pisa", 1.0, 0], ["Sagrada Familia", 41.4036, 2.1744, "spires", 1.0, 0],
  ["Brandenburg Gate", 52.5163, 13.3777, "gate", 1.0, 0], ["Berlin TV Tower", 52.5208, 13.4094, "spire", 0.9, 0], ["St Basil's Cathedral", 55.7525, 37.6231, "onion", 1.0, 0], ["Hagia Sophia", 41.0086, 28.98, "mosque", 1.0, 0],
  ["Blue Mosque", 41.0054, 28.9768, "mosque", 0.9, 90], ["Acropolis", 37.9715, 23.7257, "parthenon", 1.0, 0], ["Burj Khalifa", 25.1972, 55.2744, "spire", 1.35, 0], ["Petronas Towers", 3.1579, 101.7116, "twintowers", 1.0, 0],
  ["Taipei 101", 25.0339, 121.5645, "stacked", 1.0, 0], ["Tokyo Tower", 35.6586, 139.7454, "lattice", 0.85, 0], ["Tokyo Skytree", 35.7101, 139.8107, "spire", 1.2, 0], ["Oriental Pearl Tower", 31.2397, 121.4998, "pearl", 1.0, 0],
  ["Great Wall, Badaling", 40.3598, 116.02, "greatwall", 1.0, 40], ["Forbidden City", 39.9163, 116.3972, "palace", 1.0, 0], ["Temple of Heaven, Beijing", 39.8822, 116.4066, "pagoda", 0.8, 0], ["Shwedagon Pagoda", 16.7983, 96.1495, "stupa", 1.0, 0],
  ["Sydney Opera House", -33.8568, 151.2153, "opera", 1.0, 40], ["Sydney Harbour Bridge", -33.8523, 151.2108, "arcbridge", 1.0, 20], ["Uluru", -25.3444, 131.0369, "rock", 1.0, 0],
  ["Statue of Liberty", 40.6892, -74.0445, "liberty", 1.0, 0], ["Empire State Building", 40.7484, -73.9857, "empire", 1.0, 0], ["Golden Gate Bridge", 37.8199, -122.4783, "suspension", 1.0, 70], ["Space Needle", 47.6205, -122.3493, "spaceneedle", 1.0, 0],
  ["Gateway Arch", 38.6247, -90.1848, "gatewayarch", 1.0, 0], ["CN Tower", 43.6426, -79.3871, "spire", 1.15, 0], ["Hoover Dam", 36.0161, -114.7377, "dam", 1.0, 20], ["Mount Rushmore", 43.8791, -103.4591, "rushmore", 1.0, 0],
  ["US Capitol", 38.8899, -77.0091, "capitol", 1.0, 0], ["Washington Monument", 38.8895, -77.0353, "obelisk", 1.0, 0], ["Lincoln Memorial", 38.8893, -77.0502, "parthenon", 0.6, 0], ["Chrysler Building", 40.7516, -73.9755, "spire", 0.7, 0],
  ["Christ the Redeemer", -22.9519, -43.2105, "christ", 1.0, 0], ["Chichen Itza El Castillo", 20.6843, -88.5678, "steppyramid", 1.0, 0], ["Machu Picchu Ruins", -13.1631, -72.545, "ruinfort", 0.8, 0], ["Teotihuacan Sun Pyramid", 19.6925, -98.8438, "steppyramid", 1.1, 0],
  ["Great Pyramid of Giza", 29.9792, 31.1342, "pyramid", 1.2, 0], ["Sphinx", 29.9753, 31.1376, "sphinx", 1.0, 90], ["Abu Simbel", 22.3369, 31.6258, "rockfacade", 1.0, 0], ["Table Mountain Cableway", -33.9487, 18.4033, "pylon", 1.0, 0],
  ["Taj Mahal", 27.1751, 78.0421, "taj", 1.0, 0], ["India Gate", 28.6129, 77.2295, "gate", 0.8, 0], ["Golden Temple, Amritsar", 31.62, 74.8765, "goldendome", 0.7, 0], ["Hawa Mahal", 26.9239, 75.8267, "palace", 0.6, 0],
  ["Angkor Wat", 13.4125, 103.867, "angkor", 1.0, 0], ["Borobudur", -7.6079, 110.2038, "stupapyramid", 1.0, 0], ["Petra Treasury", 30.3285, 35.4444, "rockfacade", 0.8, 0], ["Kaiserdom Cologne", 50.9413, 6.9583, "cathedral", 1.0, 0],
  ["Stonehenge Circle", 51.1789, -1.8262, "stonecircle", 1.0, 0], ["Neuschwanstein", 47.5576, 10.7498, "castle", 1.0, 0], ["Matterhorn Hut", 45.9763, 7.6586, "rock", 0.5, 0], ["Atomium", 50.8949, 4.3415, "atomium", 1.0, 0],
  ["Seven Mile Bridge", 24.7, -81.17, "viaduct", 1.0, 40], ["Millau Viaduct", 44.0775, 3.0225, "viaduct", 1.0, 0], ["Oresund Bridge", 55.5743, 12.8, "viaduct", 1.0, 100], ["Palm Jumeirah Atlantis", 25.1304, 55.1171, "palaceblue", 1.0, 0],
];
// the places in the teleport list of the menu, in the order they appear: [name, lat, lon]
EARTH_FEATURES.places = [
  ["Paris", 48.8566, 2.3522], ["Jerusalem", 31.7683, 35.2137], ["Tel Aviv", 32.0853, 34.7818], ["London", 51.5074, -0.1278], ["Rome", 41.9028, 12.4964], ["New York", 40.7128, -74.006], ["Tokyo", 35.6762, 139.6503],
  ["Sydney", -33.8688, 151.2093], ["Rio de Janeiro", -22.9068, -43.1729], ["Cairo", 30.0444, 31.2357], ["Istanbul", 41.0082, 28.9784], ["Dubai", 25.2048, 55.2708], ["Hong Kong", 22.3193, 114.1694], ["Singapore", 1.3521, 103.8198],
  ["San Francisco", 37.7749, -122.4194], ["Los Angeles", 34.0522, -118.2437], ["Honolulu", 21.3069, -157.8583], ["Mexico City", 19.4326, -99.1332], ["Cape Town", -33.9249, 18.4241], ["Athens", 37.9838, 23.7275],
  ["Barcelona", 41.3851, 2.1734], ["Venice", 45.4408, 12.3155], ["Amsterdam", 52.3676, 4.9041], ["Reykjavik", 64.1466, -21.9426], ["Everest", 27.9881, 86.925], ["Mont Blanc", 45.8326, 6.8652], ["Grand Canyon", 36.1069, -112.1129],
  ["Amazon river", -3.1, -60], ["Sahara", 25, 10], ["Antarctica: South Pole", -89.9, 0], ["Alaska: Denali", 63.0695, -151.0074], ["Fuji", 35.3606, 138.7274], ["Kilimanjaro", -3.0674, 37.3556], ["Galapagos", -0.9538, -90.9656],
  ["Bora Bora", -16.5004, -151.7415], ["Maldives", 3.2028, 73.2207], ["Great Barrier Reef", -18.2871, 147.6992], ["Dead Sea", 31.5, 35.5], ["Sea of Galilee", 32.8, 35.6], ["Eilat", 29.5577, 34.9519], ["Mecca region: Jeddah", 21.4858, 39.1925],
  ["Moscow", 55.7558, 37.6173], ["Beijing", 39.9042, 116.4074], ["Mumbai", 19.076, 72.8777], ["Bangkok", 13.7563, 100.5018], ["Nairobi", -1.2921, 36.8219], ["Buenos Aires", -34.6037, -58.3816], ["Lima", -12.0464, -77.0428],
  ["Vancouver", 49.2827, -123.1207], ["Chicago", 41.8781, -87.6298], ["Miami", 25.7617, -80.1918], ["Lisbon", 38.7223, -9.1393], ["Marrakesh", 31.6295, -7.9811], ["Auckland", -36.8509, 174.7645],
];

// the surface height (real metres above the sea) of the big lakes, with a point in each: the elevation data holds some lakes' floors and others' surfaces, so the largest are set by hand
EARTH_FEATURES.lakes = [
  ["Superior", 47.7, -87.5, 183], ["Michigan", 44, -87.2, 176], ["Huron", 45, -82.2, 176], ["Erie", 42.2, -81.2, 174], ["Ontario", 43.7, -77.9, 75], ["Victoria", -1, 33, 1135], ["Tanganyika", -6.5, 29.5, 773],
  ["Malawi", -12, 34.5, 474], ["Baikal", 53.5, 108, 456], ["Great Bear", 66, -120.5, 186], ["Great Slave", 61.5, -114, 156], ["Winnipeg", 52.5, -98, 217], ["Athabasca", 59.3, -109.5, 213], ["Reindeer", 57, -102.5, 337],
  ["Titicaca", -15.8, -69.4, 3812], ["Ladoga", 60.8, 31.5, 5], ["Onega", 61.8, 35.5, 33], ["Vanern", 58.9, 13.2, 44], ["Peipus", 58.5, 27.5, 30], ["Balkhash", 46.5, 74, 342], ["Issyk-Kul", 42.4, 77.3, 1607],
  ["Van", 38.6, 42.9, 1640], ["Chad", 13, 14.5, 280], ["Turkana", 3.6, 36, 360], ["Albert", 1.7, 30.9, 615], ["Kivu", -2, 29.1, 1460], ["Volta", 7, 0, 85], ["Kariba", -17, 28, 485], ["Nicaragua", 11.6, -85.4, 32],
  ["Winnipegosis", 52.4, -100, 254], ["Manitoba", 50.9, -98.8, 248], ["Oahe", 45, -100.4, 486], ["Sakakawea", 47.6, -102, 550], ["Mead", 36.2, -114.4, 372], ["Powell", 37, -111.5, 1128], ["Nasser", 22.5, 32, 183],
  ["Tonle Sap", 12.8, 104.2, 5], ["Poyang", 29, 116, 15], ["Dongting", 29.3, 112.9, 34], ["Taihu", 31.2, 120.2, 3], ["Qinghai", 36.9, 100.2, 3200], ["Namtso", 30.7, 90.6, 4718], ["Urmia", 37.6, 45.5, 1275],
  ["Tana", 12, 37.3, 1788], ["Mweru", -9, 28.7, 917], ["Bangweulu", -11.2, 29.8, 1140], ["Lake of the Woods", 49.2, -94.7, 323], ["Okeechobee", 27, -80.8, 4], ["Salton Sea", 33.3, -115.8, -70], ["Dead Sea", 31.5, 35.5, -430],
];
