/*!
 * FormGhost - https://github.com/mahtoaman/formghost
 * Copyright 2026 Aman Mahto (@mahtoaman)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 */
/* FormGhost: region data. Every persona is built from ONE cluster + ONE city,
   so name, city, state, pincode and phone area code always agree with each other. */
(function (G) {
  const R = {
    int: (a, b) => Math.floor(Math.random() * (b - a + 1)) + a,
    pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
    chance: (p) => Math.random() < p,
    digits: (n) => { let s = ''; for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10); return s; },
    pad: (n, w) => String(n).padStart(w, '0'),
    letters: (n, set) => { set = set || 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'; let s = ''; for (let i = 0; i < n; i++) s += set[Math.floor(Math.random() * set.length)]; return s; },
  };
  const S = (str) => str.split(',').map((x) => x.trim()).filter(Boolean);
  const grp = (d, sizes, sep = ' ') => { let out = [], i = 0; for (const n of sizes) { out.push(d.slice(i, i + n)); i += n; } if (i < d.length) out.push(d.slice(i)); return out.filter(Boolean).join(sep); };
  // NANP numbers: exchange can't start with 0/1 and can't be N11
  const nanp = (c) => { let ex; do { ex = R.int(2, 9) + R.digits(2); } while (ex.endsWith('11')); return R.pick(c.a) + ex + R.digits(4); };
  const nanpFmt = (n) => `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`;

  /* landline(city) → { std: area code as dialled at home (trunk 0 kept), number: the rest, display }; persona.js adds national / e164.
     IN: the city's STD code, else its state capital's */
  const IN_STD = {
    'New Delhi': '011', Noida: '0120', Gurugram: '0124', Lucknow: '0522', Kanpur: '0512', Varanasi: '0542', Jaipur: '0141', Chandigarh: '0172', Ludhiana: '0161', Amritsar: '0183', Dehradun: '0135', Bhopal: '0755', Indore: '0731', Raipur: '0771',
    Mumbai: '022', Thane: '022', Pune: '020', Nagpur: '0712', Nashik: '0253', Ahmedabad: '079', Surat: '0261', Vadodara: '0265', Rajkot: '0281', Panaji: '0832',
    Bengaluru: '080', Mysuru: '0821', Mangaluru: '0824', Chennai: '044', Coimbatore: '0422', Madurai: '0452', Hyderabad: '040', Warangal: '0870', Visakhapatnam: '0891', Vijayawada: '0866', Kochi: '0484', Thiruvananthapuram: '0471',
    Kolkata: '033', Howrah: '033', Siliguri: '0353', Patna: '0612', Gaya: '0631', Ranchi: '0651', Jamshedpur: '0657', Bhubaneswar: '0674', Cuttack: '0671', Guwahati: '0361',
  };
  const IN_STD_STATE = {
    Delhi: '011', 'Uttar Pradesh': '0522', Haryana: '0172', Punjab: '0172', Chandigarh: '0172', Rajasthan: '0141', Uttarakhand: '0135', 'Madhya Pradesh': '0755', Chhattisgarh: '0771', 'Himachal Pradesh': '0177', 'Jammu and Kashmir': '0194', Ladakh: '01982',
    Maharashtra: '022', Gujarat: '079', Goa: '0832', Karnataka: '080', 'Tamil Nadu': '044', Telangana: '040', 'Andhra Pradesh': '0863', Kerala: '0471', Puducherry: '0413',
    'West Bengal': '033', Bihar: '0612', Jharkhand: '0651', Odisha: '0674', Assam: '0361', Sikkim: '03592', Meghalaya: '0364', Tripura: '0381', Manipur: '0385', Mizoram: '0389', Nagaland: '0370', 'Arunachal Pradesh': '0360',
  };
  // `first`: the digits a number there starts with; random digits after it until std + number has `len` digits
  const land = (std, len, first, fmt) => { const n = R.pick(first) + R.digits(len - std.length - 1); return { std, number: n, display: fmt ? fmt(std, n) : `${std} ${n}` }; };
  const dash = (std, n) => `${std}-${n}`;
  const D29 = S('2,3,4,5,6,7,8,9');
  const nanpLand = (c) => { const n = nanp(c); return { std: n.slice(0, 3), number: n.slice(3), display: nanpFmt(n) }; };

  const IN_BLDG = S('Sai Residency,Shanti Apartments,Green Valley Towers,Krishna Enclave,Sunrise Heights,Lotus Residency,Shivam Complex,Royal Palms,Silver Oak Apartments,Ganga Vihar,Ashoka Towers,Gokul Dham Society,Prestige Park,Mahalaxmi Apartments');
  const IN_LANDMARK = S('City Mall,Metro Station,Hanuman Mandir,Government School,SBI Bank,Bus Stand,Post Office,Apollo Pharmacy,Railway Crossing,Water Tank,Gurudwara,Community Hall');

  const L = {
    IN: {
      code: 'IN', name: 'India', aliases: S('India,IN,IND,Bharat'), dateOrder: 'DMY', dateSep: '/', tld: '.in',
      emails: S('gmail.com,gmail.com,gmail.com,gmail.com,yahoo.co.in,outlook.com,rediffmail.com,yahoo.com'),
      co: { a: S('Shree Ganesh,Vedant,Kaveri,Sahyadri,Aarav,Nexa,Apex,Sunrise,BlueLeaf,Om Sai,Trident,Lakshya,Vrindavan,Navkar'), b: S('Infotech,Technologies,Traders,Softech,Consultancy,Systems,Logistics,Exports,Enterprises'), c: S('Pvt. Ltd.,Pvt. Ltd.,Pvt. Ltd.,LLP') },
      phone: { cc: '91', trunk: '', gen: () => { const f = R.pick(S('9,9,9,8,8,7,7,6')); return f === '6' ? '6' + R.pick(S('2,3,9')) + R.digits(8) : f + R.digits(9); }, fmt: (n) => grp(n, [5, 5]) },
      landline: (c) => land(IN_STD[c.n] || IN_STD_STATE[c.s] || '011', 11, S('2,2,2,4,6'), dash), // 011-2xxxxxxx, 0141-2xxxxxx
      zip: (c) => c.z + R.pad(R.int(1, 75), 2), // fallback: lib/profile.js puts in a real pincode + post office from lib/data-in.js
      address: (c) => ({
        line1: R.chance(0.55)
          ? `Flat ${R.int(1, 14)}${R.pad(R.int(1, 8), 2)}, ${R.pick(IN_BLDG)}`
          : `H.No. ${R.int(1, 899)}, ${R.pick(['Sector ' + R.int(1, 62), 'Block ' + R.pick(S('A,B,C,D,E,F,G')), 'Street No. ' + R.int(1, 18), 'Lane ' + R.int(1, 12)])}`,
        line2: `${R.pick(c.l)}, Near ${R.pick(IN_LANDMARK)}`,
      }),
      // per city: d = district, t = tehsil/taluka when they differ from the city name
      clusters: [
        { id: 'north',
          male: S('Rahul,Amit,Rohit,Vikas,Ankit,Saurabh,Gaurav,Manish,Deepak,Nitin,Abhishek,Harsh,Karan,Arjun,Vivek,Pankaj,Rajat,Akash,Mohit,Sachin,Aman,Shivam'),
          female: S('Priya,Neha,Pooja,Anjali,Shreya,Riya,Kavya,Simran,Nisha,Komal,Aarti,Swati,Megha,Ritu,Divya,Shikha,Tanvi,Muskan,Jyoti,Sakshi'),
          last: S('Sharma,Verma,Gupta,Singh,Yadav,Chauhan,Mishra,Tiwari,Pandey,Agarwal,Saxena,Srivastava,Malhotra,Kapoor,Arora,Bansal,Mehra,Rawat,Thakur,Chaudhary,Dubey,Rathore'),
          states: S('Himachal Pradesh,Jammu and Kashmir,Ladakh'),
          cities: [
            { n: 'New Delhi', s: 'Delhi', sa: 'DL', z: '1100', l: S('Lajpat Nagar,Karol Bagh,Rajouri Garden,Malviya Nagar,Dwarka Sector 12,Rohini Sector 7,Janakpuri,Mayur Vihar Phase 1,Saket,Pitampura') },
            { n: 'Noida', d: 'Gautam Buddha Nagar', t: 'Dadri', s: 'Uttar Pradesh', sa: 'UP', z: '2013', l: S('Sector 18,Sector 62,Sector 50,Sector 137,Sector 76') },
            { n: 'Gurugram', s: 'Haryana', sa: 'HR', z: '1220', l: S('DLF Phase 3,Sector 56,Sohna Road,Palam Vihar,Sushant Lok') },
            { n: 'Lucknow', s: 'Uttar Pradesh', sa: 'UP', z: '2260', l: S('Gomti Nagar,Hazratganj,Aliganj,Indira Nagar,Aashiana') },
            { n: 'Kanpur', d: 'Kanpur Nagar', s: 'Uttar Pradesh', sa: 'UP', z: '2080', l: S('Swaroop Nagar,Kidwai Nagar,Civil Lines,Kakadeo') },
            { n: 'Jaipur', s: 'Rajasthan', sa: 'RJ', z: '3020', l: S('Vaishali Nagar,Malviya Nagar,Mansarovar,C-Scheme,Raja Park') },
            { n: 'Chandigarh', s: 'Chandigarh', sa: 'CH', z: '1600', l: S('Sector 17,Sector 22,Sector 35,Manimajra') },
            { n: 'Ludhiana', s: 'Punjab', sa: 'PB', z: '1410', l: S('Model Town,Sarabha Nagar,BRS Nagar,Civil Lines') },
            { n: 'Dehradun', s: 'Uttarakhand', sa: 'UK', z: '2480', l: S('Rajpur Road,Vasant Vihar,Prem Nagar,Clement Town') },
            { n: 'Bhopal', s: 'Madhya Pradesh', sa: 'MP', z: '4620', l: S('Arera Colony,MP Nagar,Kolar Road,Shahpura') },
            { n: 'Indore', s: 'Madhya Pradesh', sa: 'MP', z: '4520', l: S('Vijay Nagar,Palasia,Rajendra Nagar,Bhawarkua') },
          ] },
        { id: 'west',
          male: S('Aditya,Omkar,Siddharth,Tejas,Prathamesh,Yash,Hardik,Parth,Chirag,Jay,Nikhil,Rohan,Sanket,Mihir,Kunal,Dhruv,Sagar,Vishal'),
          female: S('Sneha,Pooja,Rutuja,Shruti,Aishwarya,Krupa,Hetal,Janhavi,Mansi,Prachi,Dhwani,Isha,Sayali,Khushi,Nidhi,Payal'),
          last: S('Patil,Deshmukh,Kulkarni,Joshi,Pawar,Shinde,Jadhav,Gaikwad,Patel,Shah,Mehta,Desai,Parikh,Trivedi,Bhatt,Chavan,Naik,Kamat,Sawant,More'),
          states: S('Dadra and Nagar Haveli and Daman and Diu'),
          cities: [
            { n: 'Mumbai', d: 'Mumbai Suburban', t: 'Andheri', s: 'Maharashtra', sa: 'MH', z: '4000', l: S('Andheri West,Bandra East,Powai,Dadar West,Borivali East,Goregaon West,Malad West,Chembur') },
            { n: 'Pune', t: 'Haveli', s: 'Maharashtra', sa: 'MH', z: '4110', l: S('Kothrud,Baner,Hinjewadi Phase 1,Viman Nagar,Wakad,Shivaji Nagar,Hadapsar') },
            { n: 'Thane', s: 'Maharashtra', sa: 'MH', z: '4006', l: S('Ghodbunder Road,Naupada,Vartak Nagar,Majiwada') },
            { n: 'Nagpur', s: 'Maharashtra', sa: 'MH', z: '4400', l: S('Dharampeth,Sitabuldi,Manish Nagar,Civil Lines') },
            { n: 'Nashik', s: 'Maharashtra', sa: 'MH', z: '4220', l: S('College Road,Gangapur Road,Indira Nagar') },
            { n: 'Ahmedabad', s: 'Gujarat', sa: 'GJ', z: '3800', l: S('Navrangpura,Satellite,Vastrapur,Bodakdev,Maninagar,Prahlad Nagar') },
            { n: 'Surat', s: 'Gujarat', sa: 'GJ', z: '3950', l: S('Adajan,Vesu,Athwa,Piplod') },
            { n: 'Vadodara', s: 'Gujarat', sa: 'GJ', z: '3900', l: S('Alkapuri,Gotri,Manjalpur,Fatehgunj') },
            { n: 'Rajkot', s: 'Gujarat', sa: 'GJ', z: '3600', l: S('Kalawad Road,Raiya Road,University Road') },
            { n: 'Panaji', d: 'North Goa', t: 'Tiswadi', s: 'Goa', sa: 'GA', z: '4030', l: S('Miramar,Altinho,Dona Paula,Panjim Market') },
          ] },
        { id: 'south',
          male: S('Karthik,Arun,Vignesh,Suresh,Pradeep,Rajesh,Srinivas,Venkatesh,Harish,Naveen,Praveen,Kiran,Sai,Manoj,Anand,Rohith,Varun,Akhil,Vishnu,Ajith'),
          female: S('Lakshmi,Divya,Keerthana,Swathi,Anusha,Bhavana,Deepika,Meera,Nandini,Priyanka,Sowmya,Harini,Kavitha,Ramya,Sandhya,Lavanya,Athira,Revathi'),
          last: S('Iyer,Nair,Reddy,Rao,Menon,Pillai,Krishnan,Subramanian,Naidu,Gowda,Shetty,Hegde,Kumar,Raju,Murthy,Varma,Chowdary,Prasad,Rajan,Srinivasan'),
          states: S('Puducherry,Lakshadweep,Andaman and Nicobar Islands'),
          cities: [
            { n: 'Bengaluru', d: 'Bengaluru Urban', t: 'Bengaluru South', s: 'Karnataka', sa: 'KA', z: '5600', l: S('Koramangala,Indiranagar,Whitefield,HSR Layout,Jayanagar 4th Block,BTM Layout,Marathahalli,Electronic City') },
            { n: 'Mysuru', s: 'Karnataka', sa: 'KA', z: '5700', l: S('Vijayanagar,Kuvempunagar,Saraswathipuram') },
            { n: 'Mangaluru', d: 'Dakshina Kannada', s: 'Karnataka', sa: 'KA', z: '5750', l: S('Kadri,Bejai,Kankanady') },
            { n: 'Chennai', s: 'Tamil Nadu', sa: 'TN', z: '6000', l: S('T. Nagar,Anna Nagar,Adyar,Velachery,Mylapore,Tambaram,Porur') },
            { n: 'Coimbatore', s: 'Tamil Nadu', sa: 'TN', z: '6410', l: S('RS Puram,Gandhipuram,Saibaba Colony,Peelamedu') },
            { n: 'Madurai', s: 'Tamil Nadu', sa: 'TN', z: '6250', l: S('Anna Nagar,KK Nagar,Tallakulam') },
            { n: 'Hyderabad', s: 'Telangana', sa: 'TS', z: '5000', l: S('Banjara Hills,Gachibowli,Madhapur,Kukatpally,Jubilee Hills,Kondapur,Ameerpet') },
            { n: 'Warangal', s: 'Telangana', sa: 'TS', z: '5060', l: S('Hanamkonda,Kazipet,Subedari') },
            { n: 'Visakhapatnam', s: 'Andhra Pradesh', sa: 'AP', z: '5300', l: S('MVP Colony,Dwaraka Nagar,Seethammadhara,Gajuwaka') },
            { n: 'Vijayawada', d: 'NTR', s: 'Andhra Pradesh', sa: 'AP', z: '5200', l: S('Benz Circle,Labbipet,Patamata') },
            { n: 'Kochi', d: 'Ernakulam', t: 'Kanayannur', s: 'Kerala', sa: 'KL', z: '6820', l: S('Kakkanad,Edappally,Kaloor,Panampilly Nagar,Vyttila') },
            { n: 'Thiruvananthapuram', s: 'Kerala', sa: 'KL', z: '6950', l: S('Pattom,Kowdiar,Vazhuthacaud,Sasthamangalam') },
          ] },
        { id: 'east',
          male: S('Sourav,Arijit,Subhajit,Debashish,Abhijit,Ankan,Rupam,Sandeep,Bikash,Pritam,Ritesh,Rakesh,Satyam,Pratyush,Ayan,Soumya'),
          female: S('Ananya,Debolina,Moumita,Sreoshi,Tanushree,Payel,Riya,Puja,Sushmita,Ankita,Swagata,Priyanka,Shalini,Madhuri,Rimjhim'),
          last: S('Banerjee,Chatterjee,Mukherjee,Das,Ghosh,Bose,Sen,Dutta,Roy,Chakraborty,Mondal,Saha,Sinha,Jha,Mohanty,Patnaik,Mahapatra,Sahu,Kumar,Prasad'),
          states: S('Sikkim,Meghalaya,Tripura,Manipur,Mizoram,Nagaland,Arunachal Pradesh,Chhattisgarh'),
          cities: [
            { n: 'Kolkata', s: 'West Bengal', sa: 'WB', z: '7000', l: S('Salt Lake Sector V,New Town,Ballygunge,Behala,Park Street,Dum Dum,Garia,Tollygunge') },
            { n: 'Howrah', s: 'West Bengal', sa: 'WB', z: '7111', l: S('Shibpur,Bally,Santragachi') },
            { n: 'Siliguri', d: 'Darjeeling', s: 'West Bengal', sa: 'WB', z: '7340', l: S('Pradhan Nagar,Hakimpara,Sevoke Road') },
            { n: 'Patna', t: 'Patna Sadar', s: 'Bihar', sa: 'BR', z: '8000', l: S('Boring Road,Kankarbagh,Patliputra Colony,Rajendra Nagar,Bailey Road') },
            { n: 'Gaya', s: 'Bihar', sa: 'BR', z: '8230', l: S('Civil Lines,AP Colony,Bodh Gaya Road') },
            { n: 'Ranchi', s: 'Jharkhand', sa: 'JH', z: '8340', l: S('Lalpur,Harmu,Morabadi,Kanke Road') },
            { n: 'Jamshedpur', d: 'East Singhbhum', t: 'Jamshedpur', s: 'Jharkhand', sa: 'JH', z: '8310', l: S('Bistupur,Sakchi,Kadma,Sonari') },
            { n: 'Bhubaneswar', d: 'Khordha', s: 'Odisha', sa: 'OD', z: '7510', l: S('Saheed Nagar,Patia,Nayapalli,Chandrasekharpur') },
            { n: 'Cuttack', s: 'Odisha', sa: 'OD', z: '7530', l: S('Buxi Bazaar,CDA Sector 6,Link Road') },
            { n: 'Guwahati', d: 'Kamrup Metropolitan', s: 'Assam', sa: 'AS', z: '7810', l: S('Dispur,Zoo Road,Beltola,Ganeshguri,Paltan Bazaar') },
          ] },
      ],
    },

    US: {
      code: 'US', name: 'United States', aliases: S('United States,United States of America,USA,US,America'), dateOrder: 'MDY', dateSep: '/', tld: '.com',
      emails: S('gmail.com,gmail.com,gmail.com,yahoo.com,outlook.com,icloud.com,hotmail.com,aol.com'),
      co: { a: S('Bluebird,Northstar,Silverline,Brightpath,Evergreen,Summit,Pinnacle,Redwood,Lakeside,Ironwood,Keystone,Harbor'), b: S('Solutions,Technologies,Group,Partners,Logistics,Labs,Holdings,Consulting'), c: S('Inc.,LLC,Inc.,Co.') },
      phone: { cc: '1', trunk: '', gen: nanp, fmt: nanpFmt },
      landline: nanpLand,
      zip: (c) => c.z + R.pad(R.int(1, 99), 2),
      address: () => ({
        line1: `${R.int(100, 9899)} ${R.pick(S('Maple Avenue,Oak Street,Pine Street,Cedar Lane,Elm Street,Washington Avenue,Lake Drive,Park Avenue,Highland Avenue,Main Street,Willow Way,Hillcrest Drive,Ridge Road,Lincoln Street,Sunset Boulevard,Jefferson Street'))}`,
        line2: R.chance(0.5) ? `Apt ${R.int(1, 40)}${R.pick(S('A,B,C,D'))}` : `Suite ${R.int(100, 450)}`,
      }),
      clusters: [{ id: 'us',
        male: S('James,John,Robert,Michael,William,David,Joseph,Daniel,Matthew,Andrew,Joshua,Ryan,Tyler,Brandon,Ethan,Nathan,Kevin,Justin,Jason,Eric,Christopher,Benjamin'),
        female: S('Emily,Jessica,Ashley,Sarah,Jennifer,Amanda,Megan,Lauren,Rachel,Hannah,Olivia,Madison,Samantha,Taylor,Nicole,Rebecca,Abigail,Elizabeth,Natalie,Grace'),
        last: S('Smith,Johnson,Williams,Brown,Jones,Garcia,Miller,Davis,Rodriguez,Martinez,Wilson,Anderson,Thomas,Taylor,Moore,Jackson,Martin,Lee,Thompson,White,Harris,Clark,Lewis,Walker,Hall,Young,Allen,King,Wright,Scott'),
        cities: [
          { n: 'New York', s: 'New York', sa: 'NY', z: '100', a: S('212,646,917') },
          { n: 'Los Angeles', s: 'California', sa: 'CA', z: '900', a: S('213,310,323') },
          { n: 'San Francisco', s: 'California', sa: 'CA', z: '941', a: S('415,628') },
          { n: 'Chicago', s: 'Illinois', sa: 'IL', z: '606', a: S('312,773,872') },
          { n: 'Houston', s: 'Texas', sa: 'TX', z: '770', a: S('713,832,281') },
          { n: 'Austin', s: 'Texas', sa: 'TX', z: '787', a: S('512,737') },
          { n: 'Phoenix', s: 'Arizona', sa: 'AZ', z: '850', a: S('602,480') },
          { n: 'Seattle', s: 'Washington', sa: 'WA', z: '981', a: S('206,425') },
          { n: 'Denver', s: 'Colorado', sa: 'CO', z: '802', a: S('303,720') },
          { n: 'Boston', s: 'Massachusetts', sa: 'MA', z: '021', a: S('617,857') },
          { n: 'Atlanta', s: 'Georgia', sa: 'GA', z: '303', a: S('404,678') },
          { n: 'Miami', s: 'Florida', sa: 'FL', z: '331', a: S('305,786') },
          { n: 'Philadelphia', s: 'Pennsylvania', sa: 'PA', z: '191', a: S('215,267') },
        ] }],
    },

    GB: {
      code: 'GB', name: 'United Kingdom', aliases: S('United Kingdom,UK,GB,GBR,Great Britain,England,Britain'), dateOrder: 'DMY', dateSep: '/', tld: '.co.uk',
      emails: S('gmail.com,gmail.com,outlook.com,hotmail.co.uk,yahoo.co.uk,btinternet.com,icloud.com'),
      co: { a: S('Thames,Kingsway,Crown,Albion,Oakridge,Hawthorn,Sterling,Windsor,Ashford,Brightwater'), b: S('Consulting,Services,Group,Solutions,Trading,Partners,Digital'), c: S('Ltd,Ltd,Ltd,LLP') },
      phone: { cc: '44', trunk: '0', gen: () => '07' + R.pick(S('4,5,7,8,9')) + R.digits(8), fmt: (n) => grp(n, [5, 6]) },
      landline: (c) => { const std = { Manchester: '0161', Birmingham: '0121', Leeds: '0113', Liverpool: '0151', Bristol: '0117', Glasgow: '0141', Edinburgh: '0131' }[c.n] || '020';
        return land(std, 11, std === '020' ? S('3,7,8') : D29, (a, n) => `${a} ${grp(n, a.length === 3 ? [4, 4] : [3, 4])}`); }, // 020 7xxx xxxx, 0161 xxx xxxx
      zip: (c) => `${R.pick(c.z)} ${R.int(1, 9)}${R.letters(2, 'ABDEFGHJLNPQRSTUWXYZ')}`,
      address: () => ({
        line1: `${R.int(1, 180)} ${R.pick(S('High Street,Station Road,Church Lane,Victoria Road,Park Road,Kings Road,Queens Avenue,Mill Lane,Green Lane,Manor Road,The Crescent,Grove Road,Albert Street'))}`,
        line2: R.chance(0.6) ? `Flat ${R.int(1, 24)}` : '',
      }),
      clusters: [{ id: 'gb',
        male: S('Oliver,Harry,George,Jack,Charlie,Thomas,James,William,Daniel,Joshua,Alfie,Samuel,Henry,Freddie,Archie,Leo,Callum,Lewis'),
        female: S('Olivia,Amelia,Isla,Ava,Emily,Sophie,Grace,Lily,Chloe,Ella,Charlotte,Jessica,Lucy,Evie,Poppy,Freya,Holly,Megan'),
        last: S('Smith,Jones,Taylor,Brown,Williams,Wilson,Johnson,Davies,Robinson,Wright,Thompson,Evans,Walker,White,Roberts,Green,Hall,Wood,Jackson,Clarke,Hughes,Edwards'),
        cities: [
          { n: 'London', s: 'Greater London', z: S('SW1A,SW11,E1,E14,N1,N7,W1D,W2,SE1,SE15,NW1,NW3') },
          { n: 'Manchester', s: 'Greater Manchester', z: S('M1,M4,M14,M20') },
          { n: 'Birmingham', s: 'West Midlands', z: S('B1,B5,B15,B29') },
          { n: 'Leeds', s: 'West Yorkshire', z: S('LS1,LS6,LS8') },
          { n: 'Liverpool', s: 'Merseyside', z: S('L1,L8,L17') },
          { n: 'Bristol', s: 'Bristol', z: S('BS1,BS6,BS8') },
          { n: 'Glasgow', s: 'Scotland', z: S('G1,G3,G12') },
          { n: 'Edinburgh', s: 'Scotland', z: S('EH1,EH3,EH10') },
        ] }],
    },

    CA: {
      code: 'CA', name: 'Canada', aliases: S('Canada,CA,CAN'), dateOrder: 'DMY', dateSep: '/', tld: '.ca',
      emails: S('gmail.com,gmail.com,outlook.com,hotmail.ca,yahoo.ca,icloud.com'),
      co: { a: S('Maple Leaf,Northern,Laurentian,Pacific,Polaris,Cedar,Boreal,Lakeshore,Summit'), b: S('Solutions,Technologies,Group,Consulting,Logistics,Systems'), c: S('Inc.,Ltd.,Corp.') },
      phone: { cc: '1', trunk: '', gen: nanp, fmt: nanpFmt },
      landline: nanpLand,
      zip: (c) => `${R.pick(c.z)} ${R.int(0, 9)}${R.letters(1, 'ABCEGHJKLMNPRSTVWXYZ')}${R.int(0, 9)}`,
      address: (c) => ({
        line1: `${R.int(10, 4800)} ${R.pick(c.st)}`,
        line2: R.chance(0.5) ? `Unit ${R.int(101, 2405)}` : '',
      }),
      clusters: [{ id: 'ca',
        male: S('Liam,Noah,Ethan,Lucas,Benjamin,Logan,Owen,Jacob,Nathan,Mathieu,Alexandre,Dylan,Connor,Ryan,Gabriel'),
        female: S('Emma,Olivia,Charlotte,Chloe,Sophie,Ava,Emily,Abigail,Zoe,Maya,Léa,Camille,Hannah,Megan,Florence'),
        last: S('Smith,Brown,Tremblay,Martin,Roy,Gagnon,Lee,Wilson,Johnson,MacDonald,Taylor,Campbell,Anderson,Leblanc,Côté,Bouchard,Morin,Singh,Wong,Patel'),
        cities: [
          { n: 'Toronto', s: 'Ontario', sa: 'ON', z: S('M5V,M4C,M6J,M5A,M4Y'), a: S('416,647,437'), st: S('Queen Street West,King Street East,Yonge Street,Bloor Street West,Dundas Street') },
          { n: 'Ottawa', s: 'Ontario', sa: 'ON', z: S('K1P,K2P,K1N'), a: S('613,343'), st: S('Bank Street,Elgin Street,Rideau Street') },
          { n: 'Vancouver', s: 'British Columbia', sa: 'BC', z: S('V6B,V5K,V6E'), a: S('604,778'), st: S('Granville Street,Robson Street,Main Street,Commercial Drive') },
          { n: 'Montreal', s: 'Quebec', sa: 'QC', z: S('H2X,H3B,H2T'), a: S('514,438'), st: S('Rue Sainte-Catherine,Boulevard Saint-Laurent,Rue Sherbrooke') },
          { n: 'Calgary', s: 'Alberta', sa: 'AB', z: S('T2P,T3A,T2R'), a: S('403,587'), st: S('17 Avenue SW,Macleod Trail,Centre Street') },
        ] }],
    },

    AU: {
      code: 'AU', name: 'Australia', aliases: S('Australia,AU,AUS'), dateOrder: 'DMY', dateSep: '/', tld: '.com.au',
      emails: S('gmail.com,gmail.com,outlook.com,bigpond.com,hotmail.com,icloud.com'),
      co: { a: S('Southern Cross,Coastal,Bluegum,Outback,Harbourside,Wattle,Kookaburra,Eastern'), b: S('Solutions,Services,Group,Consulting,Trading,Digital'), c: S('Pty Ltd,Pty Ltd') },
      phone: { cc: '61', trunk: '0', gen: () => '04' + R.digits(8), fmt: (n) => grp(n, [4, 3, 3]) },
      landline: (c) => { const [std, first] = { NSW: ['02', '89'], ACT: ['02', '6'], VIC: ['03', '89'], QLD: ['07', '3'], SA: ['08', '8'], WA: ['08', '69'] }[c.sa] || ['02', '9'];
        return land(std, 10, first.split(''), (a, n) => `(${a}) ${grp(n, [4, 4])}`); }, // (02) 9xxx xxxx
      zip: (c) => R.pick(c.z),
      address: () => ({
        line1: `${R.int(1, 420)} ${R.pick(S('George Street,Collins Street,Queen Street,Pitt Street,Bourke Street,Hay Street,Beach Road,Church Street,Smith Street,Victoria Parade'))}`,
        line2: R.chance(0.5) ? `Unit ${R.int(1, 40)}` : '',
      }),
      clusters: [{ id: 'au',
        male: S('Jack,William,Oliver,Noah,Thomas,James,Lachlan,Ethan,Liam,Cooper,Riley,Mitchell,Harrison,Hamish'),
        female: S('Charlotte,Olivia,Mia,Chloe,Emily,Isla,Ruby,Sophie,Grace,Zoe,Matilda,Ella,Georgia,Jessica'),
        last: S('Smith,Jones,Williams,Brown,Wilson,Taylor,Johnson,White,Martin,Anderson,Thompson,Nguyen,Thomas,Walker,Harris,Ryan,Kelly,Mitchell'),
        cities: [
          { n: 'Sydney', s: 'New South Wales', sa: 'NSW', z: S('2000,2010,2026,2065,2150') },
          { n: 'Melbourne', s: 'Victoria', sa: 'VIC', z: S('3000,3121,3141,3181') },
          { n: 'Brisbane', s: 'Queensland', sa: 'QLD', z: S('4000,4101,4006') },
          { n: 'Perth', s: 'Western Australia', sa: 'WA', z: S('6000,6008,6050') },
          { n: 'Adelaide', s: 'South Australia', sa: 'SA', z: S('5000,5067') },
          { n: 'Canberra', s: 'Australian Capital Territory', sa: 'ACT', z: S('2600,2612') },
        ] }],
    },

    DE: {
      code: 'DE', name: 'Germany', aliases: S('Germany,Deutschland,DE,DEU'), dateOrder: 'DMY', dateSep: '.', tld: '.de',
      emails: S('gmail.com,web.de,gmx.de,t-online.de,outlook.de,gmx.net'),
      co: { a: S('Rhein,Nordlicht,Alpen,Elbe,Kaiser,Weber,Sonnenberg,Lindhof'), b: S('Technik,Logistik,Consulting,Systeme,Handel,Software'), c: S('GmbH,GmbH,AG,GmbH & Co. KG') },
      phone: { cc: '49', trunk: '0', gen: () => '01' + R.pick(S('51,52,57,59,60,62,63,70,71,72,73,74,75,76,77,78,79')) + R.digits(8), fmt: (n) => grp(n, [4, 8]) },
      landline: (c) => land({ München: '089', Hamburg: '040', Köln: '0221', Düsseldorf: '0211', 'Frankfurt am Main': '069', Stuttgart: '0711' }[c.n] || '030', 11, D29), // 030 xxxxxxxx, 0221 xxxxxxx
      zip: (c) => R.pick(c.z),
      address: () => ({
        line1: `${R.pick(S('Hauptstraße,Bahnhofstraße,Gartenstraße,Schulstraße,Lindenstraße,Bergstraße,Goethestraße,Schillerstraße,Kirchstraße,Waldstraße,Friedrichstraße,Mozartstraße'))} ${R.int(1, 120)}`,
        line2: R.chance(0.3) ? `${R.int(1, 5)}. OG` : '',
      }),
      clusters: [{ id: 'de',
        male: S('Lukas,Leon,Finn,Jonas,Paul,Felix,Maximilian,Elias,Noah,Ben,Tim,Jan,Niklas,Moritz,Julian,Tobias'),
        female: S('Anna,Lena,Leonie,Hannah,Lea,Laura,Sophie,Marie,Emma,Mia,Lina,Johanna,Clara,Katharina,Julia,Sarah'),
        last: S('Müller,Schmidt,Schneider,Fischer,Weber,Meyer,Wagner,Becker,Schulz,Hoffmann,Schäfer,Koch,Bauer,Richter,Klein,Wolf,Schröder,Neumann,Zimmermann,Braun'),
        cities: [
          { n: 'Berlin', s: 'Berlin', sa: 'BE', z: S('10115,10178,10247,10437,12043,10827') },
          { n: 'München', s: 'Bayern', sa: 'BY', z: S('80331,80469,80799,81667') },
          { n: 'Hamburg', s: 'Hamburg', sa: 'HH', z: S('20095,20354,22765') },
          { n: 'Köln', s: 'Nordrhein-Westfalen', sa: 'NW', z: S('50667,50674,50823') },
          { n: 'Düsseldorf', s: 'Nordrhein-Westfalen', sa: 'NW', z: S('40210,40213,40477') },
          { n: 'Frankfurt am Main', s: 'Hessen', sa: 'HE', z: S('60311,60318,60594') },
          { n: 'Stuttgart', s: 'Baden-Württemberg', sa: 'BW', z: S('70173,70178,70190') },
        ] }],
    },

    FR: {
      code: 'FR', name: 'France', aliases: S('France,FR,FRA'), dateOrder: 'DMY', dateSep: '/', tld: '.fr',
      emails: S('gmail.com,gmail.com,orange.fr,free.fr,laposte.net,hotmail.fr,outlook.fr'),
      co: { a: S('Lumière,Atlantique,Provence,Horizon,Étoile,Belleville,Saint-Clair'), b: S('Conseil,Services,Technologies,Solutions,Distribution'), c: S('SARL,SAS,SA') },
      phone: { cc: '33', trunk: '0', gen: () => '0' + R.pick(S('6,7')) + R.digits(8), fmt: (n) => grp(n, [2, 2, 2, 2, 2]) },
      landline: (c) => land({ 'Île-de-France': '01', 'Pays de la Loire': '02', 'Hauts-de-France': '03', Occitanie: '05', 'Nouvelle-Aquitaine': '05' }[c.s] || '04', 10, S('1,2,3,4,5,6,7,8,9'), (a, n) => grp(a + n, [2, 2, 2, 2, 2])), // 01 xx xx xx xx
      zip: (c) => R.pick(c.z),
      address: () => ({
        line1: `${R.int(1, 140)} ${R.pick(S('Rue de la République,Rue Victor Hugo,Avenue Jean Jaurès,Rue Pasteur,Boulevard Voltaire,Rue de la Paix,Rue du Moulin,Avenue de la Gare,Rue des Lilas,Rue Nationale'))}`,
        line2: R.chance(0.5) ? `Appartement ${R.int(1, 60)}` : '',
      }),
      clusters: [{ id: 'fr',
        male: S('Lucas,Hugo,Louis,Gabriel,Arthur,Jules,Nathan,Théo,Raphaël,Thomas,Antoine,Maxime,Paul,Léo,Adrien,Mathis'),
        female: S('Emma,Léa,Chloé,Manon,Camille,Inès,Jade,Louise,Sarah,Clara,Juliette,Lucie,Zoé,Alice,Anaïs,Margaux'),
        last: S('Martin,Bernard,Dubois,Thomas,Robert,Richard,Petit,Durand,Leroy,Moreau,Simon,Laurent,Lefebvre,Michel,Garcia,David,Bertrand,Roux,Vincent,Fournier'),
        cities: [
          { n: 'Paris', s: 'Île-de-France', z: S('75001,75004,75008,75011,75015,75017,75020') },
          { n: 'Lyon', s: 'Auvergne-Rhône-Alpes', z: S('69001,69003,69006,69007') },
          { n: 'Marseille', s: "Provence-Alpes-Côte d'Azur", z: S('13001,13006,13008') },
          { n: 'Nice', s: "Provence-Alpes-Côte d'Azur", z: S('06000,06100') },
          { n: 'Toulouse', s: 'Occitanie', z: S('31000,31400,31500') },
          { n: 'Bordeaux', s: 'Nouvelle-Aquitaine', z: S('33000,33800') },
          { n: 'Lille', s: 'Hauts-de-France', z: S('59000,59800') },
          { n: 'Nantes', s: 'Pays de la Loire', z: S('44000,44100') },
        ] }],
    },

    ES: {
      code: 'ES', name: 'Spain', aliases: S('Spain,España,ES,ESP'), dateOrder: 'DMY', dateSep: '/', tld: '.es', doubleSurname: true,
      emails: S('gmail.com,gmail.com,hotmail.es,outlook.es,yahoo.es,telefonica.net'),
      co: { a: S('Ibérica,Mediterráneo,Sol,Castilla,Levante,Atlántico,Nova'), b: S('Servicios,Soluciones,Consultores,Tecnología,Distribuciones'), c: S('S.L.,S.L.,S.A.') },
      phone: { cc: '34', trunk: '', gen: () => R.pick(S('6,6,6,7')) + R.digits(8), fmt: (n) => grp(n, [3, 3, 3]) },
      landline: (c) => land({ Madrid: '91', Barcelona: '93', Bilbao: '94', Valencia: '96' }[c.n] || '95', 9, S('2,3,4,5,6,7'), (a, n) => grp(a + n, [3, 3, 3])), // 91x xxx xxx
      zip: (c) => R.pick(c.z),
      address: () => ({
        line1: `${R.pick(S('Calle Mayor,Calle Real,Avenida de la Constitución,Calle del Sol,Gran Vía,Calle de Alcalá,Calle de Valencia,Paseo del Prado,Calle Serrano'))}, ${R.int(1, 120)}`,
        line2: `${R.int(1, 8)}º ${R.pick(S('A,B,C,D'))}`,
      }),
      clusters: [{ id: 'es',
        male: S('Hugo,Martín,Lucas,Daniel,Pablo,Alejandro,Álvaro,Adrián,David,Javier,Diego,Sergio,Mario,Carlos'),
        female: S('Lucía,Sofía,Martina,María,Paula,Julia,Laura,Carmen,Sara,Elena,Alba,Claudia,Marta,Andrea'),
        last: S('García,Fernández,González,Rodríguez,López,Martínez,Sánchez,Pérez,Gómez,Martín,Jiménez,Ruiz,Hernández,Díaz,Moreno,Álvarez,Romero,Navarro'),
        cities: [
          { n: 'Madrid', s: 'Comunidad de Madrid', z: S('28001,28004,28013,28020,28045') },
          { n: 'Barcelona', s: 'Cataluña', z: S('08001,08008,08015,08025') },
          { n: 'Valencia', s: 'Comunidad Valenciana', z: S('46001,46010') },
          { n: 'Sevilla', s: 'Andalucía', z: S('41001,41005') },
          { n: 'Málaga', s: 'Andalucía', z: S('29001,29016') },
          { n: 'Bilbao', s: 'País Vasco', z: S('48001,48007') },
        ] }],
    },

    BR: {
      code: 'BR', name: 'Brazil', aliases: S('Brazil,Brasil,BR,BRA'), dateOrder: 'DMY', dateSep: '/', tld: '.com.br',
      emails: S('gmail.com,gmail.com,hotmail.com,outlook.com,uol.com.br,bol.com.br,yahoo.com.br'),
      co: { a: S('Nova Era,Horizonte,Atlântica,Cruzeiro,Ipê,Paulista,Aurora'), b: S('Serviços,Tecnologia,Comércio,Soluções,Consultoria'), c: S('Ltda.,Ltda.,S.A.') },
      phone: { cc: '55', trunk: '', gen: (c) => c.a[0] + '9' + R.int(6, 9) + R.digits(7), fmt: (n) => `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}` },
      landline: (c) => land(c.a[0], 10, S('2,3,4,5'), (a, n) => `(${a}) ${n.slice(0, 4)}-${n.slice(4)}`), // (11) 3xxx-xxxx
      zip: (c) => R.pick(c.z),
      address: () => ({
        line1: `${R.pick(S('Rua das Flores,Avenida Paulista,Rua XV de Novembro,Rua São João,Avenida Brasil,Rua Augusta,Rua dos Andradas,Avenida Atlântica'))}, ${R.int(10, 2500)}`,
        line2: R.chance(0.6) ? `Apto ${R.int(1, 22)}${R.pad(R.int(1, 8), 2)}` : 'Casa',
      }),
      clusters: [{ id: 'br',
        male: S('Gabriel,Lucas,Matheus,Pedro,Guilherme,Rafael,Gustavo,Felipe,João,Bruno,Thiago,Leonardo,Rodrigo,Vinícius'),
        female: S('Ana,Beatriz,Juliana,Mariana,Larissa,Camila,Fernanda,Gabriela,Letícia,Amanda,Bruna,Isabela,Carolina,Luana'),
        last: S('Silva,Santos,Oliveira,Souza,Rodrigues,Ferreira,Alves,Pereira,Lima,Gomes,Costa,Ribeiro,Martins,Carvalho,Almeida,Lopes,Barbosa,Rocha'),
        cities: [
          { n: 'São Paulo', s: 'São Paulo', sa: 'SP', a: ['11'], z: S('01310-100,04538-133,05402-000,01414-001'), nb: S('Bela Vista,Pinheiros,Vila Mariana,Moema,Jardim Paulista,Consolação,Itaim Bibi,Perdizes') },
          { n: 'Rio de Janeiro', s: 'Rio de Janeiro', sa: 'RJ', a: ['21'], z: S('22021-001,20040-002,22290-030'), nb: S('Copacabana,Ipanema,Botafogo,Tijuca,Leblon,Flamengo,Laranjeiras') },
          { n: 'Belo Horizonte', s: 'Minas Gerais', sa: 'MG', a: ['31'], z: S('30130-010,30140-071'), nb: S('Savassi,Funcionários,Lourdes,Santo Agostinho,Serra') },
          { n: 'Curitiba', s: 'Paraná', sa: 'PR', a: ['41'], z: S('80010-000,80420-090'), nb: S('Batel,Centro Cívico,Água Verde,Bigorrilho,Juvevê') },
          { n: 'Porto Alegre', s: 'Rio Grande do Sul', sa: 'RS', a: ['51'], z: S('90010-150,90570-020'), nb: S('Moinhos de Vento,Bom Fim,Cidade Baixa,Menino Deus,Petrópolis') },
          { n: 'Brasília', s: 'Distrito Federal', sa: 'DF', a: ['61'], z: S('70040-010,70390-100'), nb: S('Asa Sul,Asa Norte,Lago Sul,Sudoeste,Noroeste') },
          { n: 'Salvador', s: 'Bahia', sa: 'BA', a: ['71'], z: S('40020-000,41820-021'), nb: S('Barra,Pituba,Rio Vermelho,Graça,Ondina') },
        ] }],
    },

    AE: {
      code: 'AE', name: 'United Arab Emirates', aliases: S('United Arab Emirates,UAE,AE,ARE,Emirates'), dateOrder: 'DMY', dateSep: '/', tld: '.ae',
      emails: S('gmail.com,gmail.com,outlook.com,hotmail.com,yahoo.com'),
      co: { a: S('Al Noor,Gulf Star,Desert Rose,Emirates Bay,Falcon,Oasis,Crescent'), b: S('Trading,General Trading,Technologies,Contracting,Services'), c: S('LLC,LLC,FZE,FZ-LLC') },
      phone: { cc: '971', trunk: '0', gen: () => '05' + R.pick(S('0,2,4,5,6,8')) + R.digits(7), fmt: (n) => grp(n, [3, 3, 4]) },
      landline: (c) => land({ 'Abu Dhabi': '02', Sharjah: '06' }[c.n] || '04', 9, S('2,3,4,5,6,7,8'), (a, n) => `${a} ${grp(n, [3, 4])}`), // 04 xxx xxxx
      zip: () => '00000',
      address: (c) => ({
        line1: R.chance(0.6)
          ? `Apartment ${R.int(1, 42)}${R.pad(R.int(1, 12), 2)}, ${R.pick(S('Marina Heights,Al Noor Tower,Palm View Residence,Burj Vista,Sky Gardens,Al Waha Building'))}`
          : `Villa ${R.int(1, 90)}, Street ${R.int(1, 45)}`,
        line2: `${R.pick(c.l)}, P.O. Box ${R.int(10000, 99999)}`,
      }),
      clusters: [{ id: 'ae',
        male: S('Mohammed,Ahmed,Omar,Khalid,Saeed,Rashid,Abdullah,Hamdan,Sultan,Yousef,Faisal,Hassan,Ali,Majid'),
        female: S('Fatima,Aisha,Mariam,Noura,Shamma,Hessa,Latifa,Maitha,Sara,Reem,Amna,Moza,Alia,Hind'),
        last: S('Al Mansoori,Al Mazrouei,Al Shamsi,Al Ketbi,Al Hammadi,Al Suwaidi,Al Marzooqi,Al Dhaheri,Al Zaabi,Al Blooshi,Al Hashemi,Al Ali,Al Kaabi,Al Nuaimi'),
        cities: [
          { n: 'Dubai', s: 'Dubai', l: S('Dubai Marina,Jumeirah,Al Barsha,Deira,Business Bay,JLT,Downtown Dubai') },
          { n: 'Abu Dhabi', s: 'Abu Dhabi', l: S('Al Reem Island,Khalifa City,Al Khalidiyah,Al Raha') },
          { n: 'Sharjah', s: 'Sharjah', l: S('Al Majaz,Al Nahda,Al Khan,Muwaileh') },
        ] }],
    },

    PK: {
      code: 'PK', name: 'Pakistan', aliases: S('Pakistan,PK,PAK'), dateOrder: 'DMY', dateSep: '/', tld: '.pk',
      emails: S('gmail.com,gmail.com,gmail.com,yahoo.com,outlook.com,hotmail.com'),
      co: { a: S('Al Rehman,Crescent,Indus,Margalla,Ravi,Shalimar,Zam Zam'), b: S('Traders,Technologies,Enterprises,Solutions,Textiles'), c: S('(Pvt) Ltd,(Pvt) Ltd,& Co.') },
      phone: { cc: '92', trunk: '0', gen: () => '03' + R.int(0, 4) + R.digits(8), fmt: (n) => grp(n, [4, 7]) },
      landline: (c) => { const std = { Karachi: '021', Lahore: '042', Islamabad: '051', Rawalpindi: '051', Faisalabad: '041' }[c.n] || '091', big = std === '021' || std === '042';
        return land(std, big ? 11 : 10, big ? ['3'] : D29, dash); }, // 021-3xxxxxxx, 051-xxxxxxx
      zip: (c) => R.pick(c.z),
      address: (c) => ({ line1: `House ${R.int(1, 450)}, Street ${R.int(1, 40)}`, line2: R.pick(c.l) }),
      clusters: [{ id: 'pk',
        male: S('Muhammad,Ali,Ahmed,Hassan,Usman,Bilal,Hamza,Fahad,Zain,Umar,Saad,Imran,Asad,Talha,Faizan,Danish'),
        female: S('Ayesha,Fatima,Zainab,Hira,Maryam,Sana,Mahnoor,Iqra,Amna,Areeba,Sidra,Rabia,Laiba,Noor'),
        last: S('Khan,Ahmed,Malik,Hussain,Sheikh,Qureshi,Butt,Chaudhry,Raza,Siddiqui,Iqbal,Javed,Akhtar,Mirza,Abbasi,Shah'),
        cities: [
          { n: 'Karachi', s: 'Sindh', z: S('75500,74200,75300'), l: S('Gulshan-e-Iqbal,DHA Phase 6,Clifton,North Nazimabad') },
          { n: 'Lahore', s: 'Punjab', z: S('54000,54600,54792'), l: S('Gulberg III,DHA Phase 5,Johar Town,Model Town') },
          { n: 'Islamabad', s: 'Islamabad Capital Territory', z: S('44000'), l: S('F-7 Markaz,G-11,E-11,I-8') },
          { n: 'Rawalpindi', s: 'Punjab', z: S('46000'), l: S('Bahria Town,Satellite Town,Saddar') },
          { n: 'Faisalabad', s: 'Punjab', z: S('38000'), l: S('Peoples Colony,Madina Town') },
          { n: 'Peshawar', s: 'Khyber Pakhtunkhwa', z: S('25000'), l: S('Hayatabad,University Town') },
        ] }],
    },

    BD: {
      code: 'BD', name: 'Bangladesh', aliases: S('Bangladesh,BD,BGD'), dateOrder: 'DMY', dateSep: '/', tld: '.com.bd',
      emails: S('gmail.com,gmail.com,gmail.com,yahoo.com,outlook.com'),
      co: { a: S('Padma,Meghna,Bengal,Sonar Bangla,Jamuna,Rupali'), b: S('Traders,Technologies,Group,Enterprise,Solutions'), c: S('Ltd.,Ltd.') },
      phone: { cc: '880', trunk: '0', gen: () => '01' + R.pick(S('3,4,5,6,7,8,9')) + R.digits(8), fmt: (n) => grp(n, [5, 6]) },
      landline: (c) => land({ Chattogram: '031', Khulna: '041', Sylhet: '0821', Rajshahi: '0721' }[c.n] || '02', 10, D29, dash), // 02-xxxxxxxx, 031-xxxxxxx
      zip: (c) => R.pick(c.z),
      address: (c) => ({ line1: `House ${R.int(1, 120)}, Road ${R.int(1, 30)}`, line2: R.pick(c.l) }),
      clusters: [{ id: 'bd',
        male: S('Rakib,Tanvir,Arif,Hasan,Sajid,Mahmud,Shakil,Imran,Fahim,Nayeem,Rifat,Sabbir,Tahsin,Ashik'),
        female: S('Nusrat,Farzana,Sadia,Tasnim,Sumaiya,Jannatul,Tania,Afsana,Sharmin,Lamia,Anika,Sabrina,Mim,Rumana'),
        last: S('Rahman,Hossain,Islam,Ahmed,Uddin,Chowdhury,Khan,Hasan,Alam,Miah,Sarkar,Talukder,Bhuiyan,Karim'),
        cities: [
          { n: 'Dhaka', s: 'Dhaka Division', z: S('1205,1209,1212,1213,1229'), l: S('Dhanmondi,Gulshan 2,Banani,Mirpur 10,Uttara Sector 7,Mohammadpur') },
          { n: 'Chattogram', s: 'Chattogram Division', z: S('4000,4100,4203'), l: S('Agrabad,GEC Circle,Nasirabad') },
          { n: 'Sylhet', s: 'Sylhet Division', z: S('3100'), l: S('Zindabazar,Amberkhana') },
          { n: 'Khulna', s: 'Khulna Division', z: S('9100'), l: S('Sonadanga,Boyra') },
          { n: 'Rajshahi', s: 'Rajshahi Division', z: S('6000'), l: S('Shaheb Bazar,Uposhohor') },
        ] }],
    },
  };

  G.FG_R = R;
  G.FG_LOCALES = L;
})(typeof globalThis !== 'undefined' ? globalThis : self);
