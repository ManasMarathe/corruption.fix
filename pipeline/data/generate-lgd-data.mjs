#!/usr/bin/env node
// Generates data/states.json and data/districts.csv.
//
// The Local Government Directory (lgdirectory.gov.in) requires an
// interactive session to export data — there is no stable, scriptable CSV
// URL for it, and the mirrors we probed (data.gov.in resource links,
// datameet/maps) either 404, redirect to an HTML page, or only carry Census
// 2011 codes (not LGD codes). See ../README.md "LGD data caveats" for the
// URLs that were tried.
//
// So: this script embeds the data instead.
//   - STATES: the 36 states/UTs with their LGD state codes. These codes are
//     stable and well-documented (they match the Census 2011 state codes
//     for all states/UTs that existed then, plus a few appended since for
//     newer UTs), so treat these as reliable.
//   - DISTRICTS_BY_STATE: district *names* per state, from general
//     knowledge, NOT scraped from LGD. This is BEST-EFFORT:
//       * lgd_code for each district is a SYNTHETIC sequential id (100000+),
//         NOT the real LGD district code. It is unique and stable across
//         re-runs of this script (same input order -> same output), which
//         is all `offices.district_id` needs, but it will not line up with
//         official LGD district codes if you cross-reference elsewhere.
//       * District boundaries/counts change often (new districts get
//         carved out every year or two — e.g. Andhra Pradesh, Chhattisgarh,
//         Madhya Pradesh have all split districts recently). This list is a
//         snapshot and may be missing newer splits or include districts
//         since renamed.
//       * offices only OPTIONALLY link to a district (district_id is
//         nullable) and 03-import.mjs does not attempt that join for v1
//         (see README), so inaccuracies here do not corrupt office data —
//         worst case is an incomplete/stale districts table.
//   - Refresh path: re-derive this file from an authoritative LGD export
//     (manually downloaded from lgdirectory.gov.in) when accuracy matters,
//     keeping the same states.json/districts.csv shape.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// [lgd_code, name]
const STATES = [
  [1, "Jammu and Kashmir"],
  [2, "Himachal Pradesh"],
  [3, "Punjab"],
  [4, "Chandigarh"],
  [5, "Uttarakhand"],
  [6, "Haryana"],
  [7, "Delhi"],
  [8, "Rajasthan"],
  [9, "Uttar Pradesh"],
  [10, "Bihar"],
  [11, "Sikkim"],
  [12, "Arunachal Pradesh"],
  [13, "Nagaland"],
  [14, "Manipur"],
  [15, "Mizoram"],
  [16, "Tripura"],
  [17, "Meghalaya"],
  [18, "Assam"],
  [19, "West Bengal"],
  [20, "Jharkhand"],
  [21, "Odisha"],
  [22, "Chhattisgarh"],
  [23, "Madhya Pradesh"],
  [24, "Gujarat"],
  [26, "Dadra and Nagar Haveli and Daman and Diu"],
  [27, "Maharashtra"],
  [28, "Andhra Pradesh"],
  [29, "Karnataka"],
  [30, "Goa"],
  [31, "Lakshadweep"],
  [32, "Kerala"],
  [33, "Tamil Nadu"],
  [34, "Puducherry"],
  [35, "Andaman and Nicobar Islands"],
  [36, "Telangana"],
  [37, "Ladakh"],
];

const DISTRICTS_BY_STATE = {
  "Andhra Pradesh": [
    "Srikakulam", "Parvathipuram Manyam", "Vizianagaram", "Visakhapatnam",
    "Alluri Sitharama Raju", "Anakapalli", "Kakinada", "East Godavari",
    "Konaseema", "West Godavari", "Eluru", "Krishna", "NTR", "Guntur",
    "Palnadu", "Bapatla", "Prakasam", "Nellore", "Kurnool", "Nandyal",
    "Anantapur", "Sri Sathya Sai", "YSR Kadapa", "Annamayya", "Chittoor",
    "Tirupati",
  ],
  "Arunachal Pradesh": [
    "Tawang", "West Kameng", "East Kameng", "Papum Pare", "Kurung Kumey",
    "Kra Daadi", "Lower Subansiri", "Upper Subansiri", "West Siang",
    "Lepa Rada", "East Siang", "Siang", "Upper Siang", "Lower Siang",
    "Lower Dibang Valley", "Dibang Valley", "Anjaw", "Lohit", "Namsai",
    "Changlang", "Tirap", "Longding", "Kamle", "Shi Yomi",
    "Pakke Kessang", "Capital Complex Itanagar",
  ],
  Assam: [
    "Baksa", "Barpeta", "Biswanath", "Bongaigaon", "Cachar", "Charaideo",
    "Chirang", "Darrang", "Dhemaji", "Dhubri", "Dibrugarh", "Dima Hasao",
    "Goalpara", "Golaghat", "Hailakandi", "Hojai", "Jorhat", "Kamrup",
    "Kamrup Metropolitan", "Karbi Anglong", "Karimganj", "Kokrajhar",
    "Lakhimpur", "Majuli", "Morigaon", "Nagaon", "Nalbari", "Sivasagar",
    "Sonitpur", "South Salmara-Mankachar", "Tinsukia", "Udalguri",
    "West Karbi Anglong", "Bajali", "Tamulpur",
  ],
  Bihar: [
    "Araria", "Arwal", "Aurangabad", "Banka", "Begusarai", "Bhagalpur",
    "Bhojpur", "Buxar", "Darbhanga", "East Champaran", "Gaya", "Gopalganj",
    "Jamui", "Jehanabad", "Kaimur", "Katihar", "Khagaria", "Kishanganj",
    "Lakhisarai", "Madhepura", "Madhubani", "Munger", "Muzaffarpur",
    "Nalanda", "Nawada", "Patna", "Purnia", "Rohtas", "Saharsa",
    "Samastipur", "Saran", "Sheikhpura", "Sheohar", "Sitamarhi", "Siwan",
    "Supaul", "Vaishali", "West Champaran",
  ],
  Chhattisgarh: [
    "Balod", "Baloda Bazar", "Balrampur", "Bastar", "Bemetara", "Bijapur",
    "Bilaspur", "Dantewada", "Dhamtari", "Durg", "Gariaband",
    "Gaurela-Pendra-Marwahi", "Janjgir-Champa", "Jashpur", "Kabirdham",
    "Kanker", "Kondagaon", "Korba", "Koriya", "Mahasamund", "Mungeli",
    "Narayanpur", "Raigarh", "Raipur", "Rajnandgaon", "Sukma", "Surajpur",
    "Surguja", "Mohla-Manpur-Ambagarh Chowki", "Sarangarh-Bilaigarh",
    "Manendragarh-Chirmiri-Bharatpur", "Khairagarh-Chhuikhadan-Gandai",
    "Sakti",
  ],
  Goa: ["North Goa", "South Goa"],
  Gujarat: [
    "Ahmedabad", "Amreli", "Anand", "Aravalli", "Banaskantha", "Bharuch",
    "Bhavnagar", "Botad", "Chhota Udepur", "Dahod", "Dang",
    "Devbhoomi Dwarka", "Gandhinagar", "Gir Somnath", "Jamnagar",
    "Junagadh", "Kheda", "Kutch", "Mahisagar", "Mehsana", "Morbi",
    "Narmada", "Navsari", "Panchmahal", "Patan", "Porbandar", "Rajkot",
    "Sabarkantha", "Surat", "Surendranagar", "Tapi", "Vadodara", "Valsad",
  ],
  Haryana: [
    "Ambala", "Bhiwani", "Charkhi Dadri", "Faridabad", "Fatehabad",
    "Gurugram", "Hisar", "Jhajjar", "Jind", "Kaithal", "Karnal",
    "Kurukshetra", "Mahendragarh", "Nuh", "Palwal", "Panchkula", "Panipat",
    "Rewari", "Rohtak", "Sirsa", "Sonipat", "Yamunanagar",
  ],
  "Himachal Pradesh": [
    "Bilaspur", "Chamba", "Hamirpur", "Kangra", "Kinnaur", "Kullu",
    "Lahaul and Spiti", "Mandi", "Shimla", "Sirmaur", "Solan", "Una",
  ],
  Jharkhand: [
    "Bokaro", "Chatra", "Deoghar", "Dhanbad", "Dumka", "East Singhbhum",
    "Garhwa", "Giridih", "Godda", "Gumla", "Hazaribagh", "Jamtara",
    "Khunti", "Koderma", "Latehar", "Lohardaga", "Pakur", "Palamu",
    "Ramgarh", "Ranchi", "Sahebganj", "Seraikela Kharsawan", "Simdega",
    "West Singhbhum",
  ],
  Karnataka: [
    "Bagalkot", "Ballari", "Belagavi", "Bengaluru Rural", "Bengaluru Urban",
    "Bidar", "Chamarajanagar", "Chikballapur", "Chikkamagaluru",
    "Chitradurga", "Dakshina Kannada", "Davanagere", "Dharwad", "Gadag",
    "Hassan", "Haveri", "Kalaburagi", "Kodagu", "Kolar", "Koppal",
    "Mandya", "Mysuru", "Raichur", "Ramanagara", "Shivamogga", "Tumakuru",
    "Udupi", "Uttara Kannada", "Vijayapura", "Yadgir", "Vijayanagara",
  ],
  Kerala: [
    "Alappuzha", "Ernakulam", "Idukki", "Kannur", "Kasaragod", "Kollam",
    "Kottayam", "Kozhikode", "Malappuram", "Palakkad", "Pathanamthitta",
    "Thiruvananthapuram", "Thrissur", "Wayanad",
  ],
  "Madhya Pradesh": [
    "Agar Malwa", "Alirajpur", "Anuppur", "Ashoknagar", "Balaghat",
    "Barwani", "Betul", "Bhind", "Bhopal", "Burhanpur", "Chhatarpur",
    "Chhindwara", "Damoh", "Datia", "Dewas", "Dhar", "Dindori", "Guna",
    "Gwalior", "Harda", "Narmadapuram", "Indore", "Jabalpur", "Jhabua",
    "Katni", "Khandwa", "Khargone", "Mandla", "Mandsaur", "Morena",
    "Narsinghpur", "Neemuch", "Niwari", "Panna", "Raisen", "Rajgarh",
    "Ratlam", "Rewa", "Sagar", "Satna", "Sehore", "Seoni", "Shahdol",
    "Shajapur", "Sheopur", "Shivpuri", "Sidhi", "Singrauli", "Tikamgarh",
    "Ujjain", "Umaria", "Vidisha", "Maihar", "Pandhurna",
  ],
  Maharashtra: [
    "Ahmednagar", "Akola", "Amravati", "Chhatrapati Sambhajinagar", "Beed",
    "Bhandara", "Buldhana", "Chandrapur", "Dhule", "Gadchiroli", "Gondia",
    "Hingoli", "Jalgaon", "Jalna", "Kolhapur", "Latur", "Mumbai City",
    "Mumbai Suburban", "Nagpur", "Nanded", "Nandurbar", "Nashik",
    "Dharashiv", "Palghar", "Parbhani", "Pune", "Raigad", "Ratnagiri",
    "Sangli", "Satara", "Sindhudurg", "Solapur", "Thane", "Wardha",
    "Washim", "Yavatmal",
  ],
  Manipur: [
    "Bishnupur", "Chandel", "Churachandpur", "Imphal East", "Imphal West",
    "Jiribam", "Kakching", "Kamjong", "Kangpokpi", "Noney", "Pherzawl",
    "Senapati", "Tamenglong", "Tengnoupal", "Thoubal", "Ukhrul",
  ],
  Meghalaya: [
    "East Garo Hills", "East Jaintia Hills", "East Khasi Hills",
    "North Garo Hills", "Ri Bhoi", "South Garo Hills",
    "South West Garo Hills", "South West Khasi Hills", "West Garo Hills",
    "West Jaintia Hills", "West Khasi Hills", "Eastern West Khasi Hills",
  ],
  Mizoram: [
    "Aizawl", "Champhai", "Hnahthial", "Khawzawl", "Kolasib", "Lawngtlai",
    "Lunglei", "Mamit", "Saiha", "Saitual", "Serchhip",
  ],
  Nagaland: [
    "Chumoukedima", "Dimapur", "Kiphire", "Kohima", "Longleng",
    "Mokokchung", "Mon", "Niuland", "Noklak", "Peren", "Phek", "Shamator",
    "Tuensang", "Tseminyu", "Wokha", "Zunheboto",
  ],
  Odisha: [
    "Angul", "Balangir", "Balasore", "Bargarh", "Bhadrak", "Boudh",
    "Cuttack", "Deogarh", "Dhenkanal", "Gajapati", "Ganjam",
    "Jagatsinghpur", "Jajpur", "Jharsuguda", "Kalahandi", "Kandhamal",
    "Kendrapara", "Kendujhar", "Khordha", "Koraput", "Malkangiri",
    "Mayurbhanj", "Nabarangpur", "Nayagarh", "Nuapada", "Puri", "Rayagada",
    "Sambalpur", "Subarnapur", "Sundargarh",
  ],
  Punjab: [
    "Amritsar", "Barnala", "Bathinda", "Faridkot", "Fatehgarh Sahib",
    "Fazilka", "Ferozepur", "Gurdaspur", "Hoshiarpur", "Jalandhar",
    "Kapurthala", "Ludhiana", "Malerkotla", "Mansa", "Moga", "Muktsar",
    "Pathankot", "Patiala", "Rupnagar", "Sahibzada Ajit Singh Nagar",
    "Sangrur", "Shaheed Bhagat Singh Nagar", "Tarn Taran",
  ],
  Rajasthan: [
    "Ajmer", "Alwar", "Banswara", "Baran", "Barmer", "Bharatpur",
    "Bhilwara", "Bikaner", "Bundi", "Chittorgarh", "Churu", "Dausa",
    "Dholpur", "Dungarpur", "Hanumangarh", "Jaipur", "Jaisalmer", "Jalore",
    "Jhalawar", "Jhunjhunu", "Jodhpur", "Karauli", "Kota", "Nagaur",
    "Pali", "Pratapgarh", "Rajsamand", "Sawai Madhopur", "Sikar",
    "Sirohi", "Sri Ganganagar", "Tonk", "Udaipur",
  ],
  Sikkim: [
    "East Sikkim", "West Sikkim", "North Sikkim", "South Sikkim",
    "Pakyong", "Soreng",
  ],
  "Tamil Nadu": [
    "Ariyalur", "Chengalpattu", "Chennai", "Coimbatore", "Cuddalore",
    "Dharmapuri", "Dindigul", "Erode", "Kallakurichi", "Kanchipuram",
    "Kanyakumari", "Karur", "Krishnagiri", "Madurai", "Mayiladuthurai",
    "Nagapattinam", "Namakkal", "Nilgiris", "Perambalur", "Pudukkottai",
    "Ramanathapuram", "Ranipet", "Salem", "Sivaganga", "Tenkasi",
    "Thanjavur", "Theni", "Thoothukudi", "Tiruchirappalli", "Tirunelveli",
    "Tirupathur", "Tiruppur", "Tiruvallur", "Tiruvannamalai", "Tiruvarur",
    "Vellore", "Viluppuram", "Virudhunagar",
  ],
  Telangana: [
    "Adilabad", "Bhadradri Kothagudem", "Hyderabad", "Jagtial", "Jangaon",
    "Jayashankar Bhupalpally", "Jogulamba Gadwal", "Kamareddy",
    "Karimnagar", "Khammam", "Komaram Bheem", "Mahabubabad",
    "Mahabubnagar", "Mancherial", "Medak", "Medchal-Malkajgiri", "Mulugu",
    "Nagarkurnool", "Nalgonda", "Narayanpet", "Nirmal", "Nizamabad",
    "Peddapalli", "Rajanna Sircilla", "Rangareddy", "Sangareddy",
    "Siddipet", "Suryapet", "Vikarabad", "Wanaparthy", "Warangal",
    "Hanumakonda", "Yadadri Bhuvanagiri",
  ],
  Tripura: [
    "Dhalai", "Gomati", "Khowai", "North Tripura", "Sepahijala",
    "South Tripura", "Unakoti", "West Tripura",
  ],
  "Uttar Pradesh": [
    "Agra", "Aligarh", "Ambedkar Nagar", "Amethi", "Amroha", "Auraiya",
    "Ayodhya", "Azamgarh", "Baghpat", "Bahraich", "Ballia", "Balrampur",
    "Banda", "Barabanki", "Bareilly", "Basti", "Bhadohi", "Bijnor",
    "Budaun", "Bulandshahr", "Chandauli", "Chitrakoot", "Deoria", "Etah",
    "Etawah", "Farrukhabad", "Fatehpur", "Firozabad", "Gautam Buddha Nagar",
    "Ghaziabad", "Ghazipur", "Gonda", "Gorakhpur", "Hamirpur", "Hapur",
    "Hardoi", "Hathras", "Jalaun", "Jaunpur", "Jhansi", "Kannauj",
    "Kanpur Dehat", "Kanpur Nagar", "Kasganj", "Kaushambi",
    "Lakhimpur Kheri", "Kushinagar", "Lalitpur", "Lucknow", "Maharajganj",
    "Mahoba", "Mainpuri", "Mathura", "Mau", "Meerut", "Mirzapur",
    "Moradabad", "Muzaffarnagar", "Pilibhit", "Pratapgarh", "Prayagraj",
    "Raebareli", "Rampur", "Saharanpur", "Sambhal", "Sant Kabir Nagar",
    "Shahjahanpur", "Shamli", "Shravasti", "Siddharthnagar", "Sitapur",
    "Sonbhadra", "Sultanpur", "Unnao", "Varanasi",
  ],
  Uttarakhand: [
    "Almora", "Bageshwar", "Chamoli", "Champawat", "Dehradun", "Haridwar",
    "Nainital", "Pauri Garhwal", "Pithoragarh", "Rudraprayag",
    "Tehri Garhwal", "Udham Singh Nagar", "Uttarkashi",
  ],
  "West Bengal": [
    "Alipurduar", "Bankura", "Birbhum", "Cooch Behar", "Dakshin Dinajpur",
    "Darjeeling", "Hooghly", "Howrah", "Jalpaiguri", "Jhargram",
    "Kalimpong", "Kolkata", "Malda", "Murshidabad", "Nadia",
    "North 24 Parganas", "Paschim Bardhaman", "Paschim Medinipur",
    "Purba Bardhaman", "Purba Medinipur", "Purulia", "South 24 Parganas",
    "Uttar Dinajpur",
  ],
  Delhi: [
    "Central Delhi", "East Delhi", "New Delhi", "North Delhi",
    "North East Delhi", "North West Delhi", "Shahdara", "South Delhi",
    "South East Delhi", "South West Delhi", "West Delhi",
  ],
  "Jammu and Kashmir": [
    "Anantnag", "Bandipora", "Baramulla", "Budgam", "Doda", "Ganderbal",
    "Jammu", "Kathua", "Kishtwar", "Kulgam", "Kupwara", "Poonch",
    "Pulwama", "Rajouri", "Ramban", "Reasi", "Samba", "Shopian",
    "Srinagar", "Udhampur",
  ],
  Ladakh: ["Kargil", "Leh"],
  Chandigarh: ["Chandigarh"],
  Puducherry: ["Puducherry", "Karaikal", "Mahe", "Yanam"],
  "Andaman and Nicobar Islands": [
    "Nicobar", "North and Middle Andaman", "South Andaman",
  ],
  "Dadra and Nagar Haveli and Daman and Diu": [
    "Dadra and Nagar Haveli", "Daman", "Diu",
  ],
  Lakshadweep: ["Lakshadweep"],
};

const states = STATES.map(([lgd_code, name]) => ({ lgd_code, name }));
writeFileSync(
  join(__dirname, "states.json"),
  JSON.stringify(states, null, 2) + "\n"
);

const stateByName = new Map(states.map((s) => [s.name, s.lgd_code]));
let nextDistrictCode = 100000;
const rows = ["lgd_code,state_lgd_code,name"];
let total = 0;
for (const [stateName, districts] of Object.entries(DISTRICTS_BY_STATE)) {
  const stateCode = stateByName.get(stateName);
  if (stateCode === undefined) {
    throw new Error(`No state entry for "${stateName}"`);
  }
  for (const district of districts) {
    const code = nextDistrictCode++;
    const safeName = district.includes(",") ? `"${district}"` : district;
    rows.push(`${code},${stateCode},${safeName}`);
    total += 1;
  }
}
writeFileSync(join(__dirname, "districts.csv"), rows.join("\n") + "\n");

console.log(
  `Wrote ${states.length} states -> data/states.json, ${total} districts -> data/districts.csv`
);
