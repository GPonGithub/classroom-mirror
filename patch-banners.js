/**
 * patch-banners.js
 * Downloads banner images from Google Classroom CDN URLs and stores
 * them as base64 data URLs directly in the snapshot JSON.
 * Run: node patch-banners.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const SNAPSHOT_FILE = path.join(__dirname, 'data', 'classroom-snapshot.json');

// Banner URLs extracted from Google Classroom UI
const BANNER_MAP = {"ODM3NzI3NzIwNzAz":"https://lh3.googleusercontent.com/hr_crs_themes/ACP_IjEot0wgbE983GXewy_5ylEl6q9TRCTkjbZfkfEgpsi2ecp9bf0_0OjPLpG6742J1hTT6TjA-SUKbPgTj7eNlsjyn6nmRpazZGdg5gGdSCbCB8y7wpv0PNY=s1280","ODM3NDUyNjc4OTI1":"https://lh3.googleusercontent.com/hr_crs_themes/ACP_IjG8bQUBr_NrDuzcjNSqIXO1IGNZHtI75cw-RBpppgd-elDXG43ieVQh8Z5svZ-4inFWTMJgxciYsvCIx698I5ySyeJ2SmRcOvtJU1Wp2GzxSMUyOSDFB6Q=s1280","NjE1OTMzMDg5NjM4":"https://lh3.googleusercontent.com/hr_crs_themes/ACP_IjHAdEAZRvU-pJEV0fbqu4EojulGhDYSUUIRh9srEjDo7vLGVAWYGPSqimsJ1uXDatkkgsEr9Qhp2ZlevKLqns3TdQzc3f_w8XmC3fd8u6QrzDmDu_pCx0U=s1280","NzgyNzk1ODE0ODU2":"https://lh3.googleusercontent.com/hr_crs_themes/ACP_IjE_Rs_iyAp2q7TJHcyi3YyT32tOhPCyJu5HtilqYZM96_L0uK6mqPZ2ZDYWCIxXRFr2_0JBYcsGIS-xMVEXJ2oZSGWi7Zyqy_u6y8ugEj-O91EDQVif_U=s1280","NzgyNzk2MjUzNzI1":"https://lh3.googleusercontent.com/hr_crs_themes/ACP_IjHSKdJev9OZ7jeEL85LiMZztr930ZzxYw0HDierSvbmOux2c0Q0mVmF9s4SJBYnW2qp2mfBxZeHgT-BL-GbEfB62lrRWqdUhSBjCAihY-gsF92XfOGJPDg=s1280","NzgyNzk1MzQwOTEy":"https://lh3.googleusercontent.com/hr_crs_themes/ACP_IjHejHVFgOLGQD26yn4AFyJkZMJKQxObB0RfL0FmC-BkB6kXPn_smqIyQcoTUinOFekVVWfsNT4rmD9rlA6BgCuWtohrnTeIgK8E3-Mox1FtXtMUDDVxfw=s1280","NjkzNDQ0MjYzNTYz":"https://lh3.googleusercontent.com/hr_crs_themes/ACP_IjFz3bOimPno5V8u0qNyoCfJhzwvf90mbAyqrGh0PEQyDRsKL4M3WNk68bYmmEhbhXOvapxu_Bp6BpDxsFHoq-rtnOuEl0sUpLolJ_uY9ytn_EBjxpBwBRI=s1280","NzQ0MzAzNzU0NTgw":"https://lh3.googleusercontent.com/hr_crs_themes/ACP_IjHUxqA3LRmI2Lbc36RYKHA16RMahDpAgRWxGoCpggyeMmMXwa8mvHLXTbuML-HNrd0ZKb7qIdK6sexWara0VVKMzIJGqhKJbo1TwX_N9zB4Nu1WeSLqMew=s1280","NTI2NzY5MDE2MjE1":"https://lh3.googleusercontent.com/hr_crs_themes/ACP_IjFrav8s3H8ChJQgRbhlW-hJdBSCOOHEPmZRvaqkQqDpVDgX6flxi_2ygJYhY29m5_3OkyhP4Indb5fJ_9b_NyLjOz5foBR0M7dcHjrO1Qm9tHxGlsrq_Q=s1280","NjUzMjc1OTEwMjAy":"https://lh3.googleusercontent.com/hr_crs_themes/ACP_IjFbrYkqUi0jwICk020dI2Wa9kp8IZGYIY8W2z49ISSHJT0uR-RWLo2Y38kcg2fbxQy0j3Uk6ODJC91kKjIfs8ZLBhowwdqZUoRPPtEosRzLA0rMjFnj1Lw=s1280","NjUzMjc1NzE1Mjg1":"https://lh3.googleusercontent.com/hr_crs_themes/ACP_IjG3VUemCC-8R_8ekBvln_B97JhSVLP-Kdapiiuy1crBnCjcXJNl1nm2h4s1oHND2Yz3MUWDqEqvDiUehU-9Zxuff5W0s5iC_bT2esjFoaStsxKdbCHAiUo=s1280","NjUzMjc5MDI2OTgy":"https://lh3.googleusercontent.com/hr_crs_themes/ACP_IjFfYBVnXJpwvgRkQAwTSQomBu6HX0gkcYeOYwyfLFwNRHbIJJ6Ij7NtYkDRPEtErzYB_epjdADJ-LQf9CcXAbC6gIhMt_Mopp7sx60Pvhd_rKXYtSd6tw=s1280","NjkzNDQ0MTI0ODI4":"https://lh3.googleusercontent.com/hr_crs_themes/ACP_IjHBrpAbTZ4WHwbJr2B9syFPYKNawc1Y4Y0I3oeLHWPkLkAQvpZxveAxKiQXwi5oV1d8Ngs2tbN-3gJTchZsNJ7hquz-BDs6WDDocUgOMNLAcYeF2Qbj9A=s1280","NjkzNDQxODI1ODQy":"https://lh3.googleusercontent.com/hr_crs_themes/ACP_IjF2uneIP0OOKfFJgRJa10L3ZIfQuNuzF4ooN0XPCPY5-qaYwuF2adFF2s8ibmPZTAummxgLT-8SBbuIzb9J1dX3JM2ckm_I8Ppstn8NKdm-CZyHHSRt9Vg=s1280","MjU4OTUzODIyNzgy":"https://lh3.googleusercontent.com/hr_crs_themes/ACP_IjF53JwFuqoiCFpVBrgfXT2L59wNE_8jIcM4qhWW7nlyjvZg1v-XH3jKTRCE_awmduzB2q2rDM6NnIuwYNC89QRzHT_LWnU5_D3HryFAYFOrnj_G7w=s1280-fcrop64=1,020b3713ff7cf83d","NDk3OTU0NTUwNjg4":"https://lh3.googleusercontent.com/hr_crs_themes/ACP_IjGOBgzfJTXrR8g_l4XuHo4e8-LRKEEoYovYfCBkTRQRxKVR0-apMGcjm6sDyAK5l6nFuBWZ5dorGDmmE05AQbE-5vWcJDfETN32ewC1Xc1X0KmY35KBxEk=s1280","NjE3NzE1MzExMzI0":"https://lh3.googleusercontent.com/hr_crs_themes/ACP_IjFau__fdyHN-m62B_jRCsvWuuOvova80lbJrUqwWts0yi_QppvIxTto6WPRa9IcryzRBP_Q4pGz3RLmlOB_3HkVcN1NPQC4c2uDdNr8Z0jDYXs_idkuBQ=s1280","NTIzMTEyNjU3MzUz":"https://lh3.googleusercontent.com/hr_crs_themes/ACP_IjGL6UGQN7_QbBnpV9hMLTao9IV6-1YwrJ2YAyAvSeBX2ezenGTMMKB6kUTFZSHOTX95QmS4hvJa2v8S2Wnbgye8KpCJ6BKS176n9LeaXbWuMywdEN9e4wU=s1280","NTQ0MjA3MTMxNzE5":"https://lh3.googleusercontent.com/hr_crs_themes/ACP_IjGRYImu_QoikOz30zBiO8n3w-4UaYTUsiC8sqlOUYjc_uZAN03m4_yjG5PLbifCvs8AQOsIhlp1M0jUKzEk0JIj13id0eMLgBz9GjcRi3E_zX-_907O1NI=s1280","NDEzNDU5ODA0MDda":"https://lh3.googleusercontent.com/hr_crs_themes/ACP_IjHAuoLRtHZWRUxYk6zBNiUe1zYQGVTn8bjejLl4dhm94CRF61PRK4VYS-YkyIR9xP_IESi8F5jHBN4P_WB_i9MW1_Mt-zlJgbNsTBmUeUvaK-jDDA=s1280-fcrop64=1,00904bd9ffb6f168","MTUwMzYwMzYzNzVa":"https://lh3.googleusercontent.com/hr_crs_themes/ACP_IjG5LpFfBdt6xcOlYfLC1b9KJAkMrvZNrLoS3Tzl3FXUVk2EaZCJzzNzPxbAP5Ho3sV-_x3RnlXGwQ40Lh1W2Vcj3WiuPrzZW8y7kPLUnqk3SgMn=s1280-fcrop64=1,000082f4fffff5db","NDUxODQxMTQ3MzI5":"https://lh3.googleusercontent.com/hr_crs_themes/ACP_IjEosUxPfi2LdMY96sY2HpxgunvbA9NrOUf147pbCwL8KtdM-2_BnX5dRjw5_wUvcoZGCwx3sSmvu9keQ1qNMIOem2yIMj3lnOep8pdzjbiLJxKPPJPZQg=s1280","NDUxODQxODI2NzM1":"https://lh3.googleusercontent.com/hr_crs_themes/ACP_IjHhkA1z6asNpxI3H_vPzPVodNPbMO7N4YhpLBDZxcvHs0kt9rv5qJZp-73UTYzN95NCOKPJ87VvmoAW1GppuigpnCTCNsfHYtu6jAJiyWsinFYtkmBliQ=s1280","MzgwOTYwNTQxOTc2":"https://lh3.googleusercontent.com/hr_crs_themes/ACP_IjFI8cpgC3R882nLye3kGnAxCBwboy4U2_XJuT64ZyNIa9lpK5nCqyEfzewcD9vUFD8o4W1JTsj-V3OwG0EaPCLWnuCVHeynvs2YT-drNCwys6CAOXPro_Q=s1280","MzgwOTYwNTQxNTA4":"https://lh3.googleusercontent.com/hr_crs_themes/ACP_IjE5tGiUbT6uLO_FckdP1RsYLgC3S0Sq9na51MDxhcrijHvlk5bXP6jMVKj6Ye6eqNxUnOMtio6bAMxGuQ4Gka9vJTrqWrhcGsEf7FOebAcXovts-jEzOA=s1280","MTI2MzczNzUxNDY5":"https://lh3.googleusercontent.com/hr_crs_themes/ACP_IjEBJ8r_Fr6qNSJA6WOCAPQPf8BGhNwkGFfW55s9zT-RhTHuwo6O2LnE0cL3LLNOB4hve4E7moXu5qOk8lZUCRmo214G0xksgpMc2wcqyyJflENd=s1280-fcrop64=1,22784e42eefda0e9","MTI2MzczNzUxMzky":"https://lh3.googleusercontent.com/hr_crs_themes/ACP_IjFjsJ9W5xZJ-o5tAx6EN3k8iRbqHkpFsWiiOD6IA3k9Twd1TA6Rqd4gmXHZTaEQVy00hPtTH5KRcv-0nIYNmeVzhD7U_mGXwPubrVmN8Hr96f3c=s1280-fcrop64=1,000006bcffbdf84c","NDk5MjY5NzY2Mjha":"https://lh3.googleusercontent.com/hr_crs_themes/ACP_IjFb6UCXklL7M3gWGiwhZa5Ay6y95xyhGgQ865FY-JZ5KlE22BwFIFRC4jr3DFsLrDfGmiISGtTkQtdfPBZTS9SmFEfUOywY-RZodBKjlZtFynV1bg=s1280-fcrop64=1,06211327ec11d8d0","NTAxNzAxMDE3OTJa":"https://lh3.googleusercontent.com/hr_crs_themes/ACP_IjEztIUNyMQwf6gYxwcC_lkfcpS8qW_iR2x-VcNQY-p6TXmI2MZ2O3q3a68oVfiEGlDOlYsea_kOmBhDV-EgtRwsDTeyuUZr1oTuKk37svhQhg0aLQ=s1280-fcrop64=1,00004405ff34f506","NDcyNzc2NDI0MDha":"https://lh3.googleusercontent.com/hr_crs_themes/ACP_IjG8_byQ6jHzYEaP0zvBdPDqq1Usbm6O6JOtZ3al2PbXMHamsswsKcKcs-gHZj3lFC1mj5Q9fXm6knFMfN9QV5SbwnRv-mRNUTX9kHnx5ViEBrZS=s1280-fcrop64=1,039e0000f6f2faa9","MTk1OTQwNzgwNzNa":"https://lh3.googleusercontent.com/hr_crs_themes/ACP_IjHQCDdcYYfsXOZRYd3ipfj2yH56eQ1LEt3qWqwKiwKPtBt7RFfcekigK9l-SZZ0B3NTJgQuF9uaPdBRAzcNmskkzDP4Wbd1r70MWkxgaRKyB4a3=s1280-fcrop64=1,00006fe8fffff2d4","NzAyODM3NjQ3OFpa":"https://lh3.googleusercontent.com/-VWHIPqIj-NY/WYywfcS-fVI/AAAAAAAACIY/bQldclPBbq86OxhKVdsvkv6twpxLu-NWQCLcBGAs/s1280-fcrop64=1,166e80bae52dce42/urbancanaries.jpg","MTQ4OTg3NzE3NjJa":"https://lh3.googleusercontent.com/hr_crs_themes/ACP_IjGcUMPGx-u6KksCJL0IFNt-_pYsSNRMA9RV5-i-qSzPQnDMuPLqcVCGe9HpexssQWjMUIgqPtnWwOpJMzgYmZpfSQk58EBD_akD3f47biXEljfG=s1280-fcrop64=1,016f3cb5ff0a9dfc","NDE1NDA1MDk1NzNa":"https://lh3.googleusercontent.com/hr_crs_themes/ACP_IjHrrWq_o0GNOaxZNkmpwu2stfbLsjl4tosUOSwQ-foNoQsaWXFynzN2Qks9C1IKHMOZuRC4zGZQeP4r11Q0Dj3PBW_dQ85VQzeln7QVZii8udt5TQ=s1280-fcrop64=1,00003bfbffffb0bb","NDE1Mzk2NjA5Njla":"https://lh3.googleusercontent.com/hr_crs_themes/ACP_IjHcUbjkv1XN1sQWPjIdQ68fhzrXTVWup4R7dl8PmTaMgnhg_T2XKUZ_S7V_2JvkgXnkyNm44TpdqEwYPOnEun0R6Q7RUOMnR5s8kMohQYyREjhf=s1280-fcrop64=1,000080baffffd87f","NDE0NzUzNDQyMjFa":"https://lh3.googleusercontent.com/hr_crs_themes/ACP_IjGptgm2ahNhUTjmJN4pGNmwzGmT8aJ90zsuwq7yff2KGFKQ_cxYu7b2viUDV166066qnhb61nTbj-2gDjZnZSkOzNORkiC2EKV7laM-WPVZCBSJ=s1280-fcrop64=1,000057c5ffffd2a5","OTMxNzg0MTExOFpa":"https://lh3.googleusercontent.com/-j-i79-t8Nbc/Wf6ExGOJ_6I/AAAAAAAACS4/a7cZCROqfN8WgZ6J4owAUuOwfIXiTtWowCLcBGAs/s1280-fcrop64=1,00000e73ffff8107/teamlab-saga-beef-interactive-restaurant-sagaya-ginza-tokyo-designboom-03.jpg","NzAyODcxMzMwN1pa":"https://lh3.googleusercontent.com/-MSXexg_9G_s/WYyuUGrn0qI/AAAAAAAACHg/L_hiLiOqEfIWJ0fn1zXrkMTrIrwFJRfYwCLcBGAs/s1280-fcrop64=1,00004efefaa1ad58/unspecified-2.jpg","Mzk2MDAyODg3OVpa":"https://lh3.googleusercontent.com/-iSdXi2YF7oc/WHwvxZAwh2I/AAAAAAAABqE/ua_QvK_sWzcEj2tsfALUEESzyQMA8tBjACLcB/s1280-fcrop64=1,000051ebffffb332/Artist_pic6358333891433269284.jpg","MTA0Njg0Mzk3Njha":"https://lh3.googleusercontent.com/-LmgsIigqH8U/WlaCSq6-0hI/AAAAAAAADXc/OFLNHRls4AUGz1xla_X-JtkCZIGr6rc1wCLcBGAs/s1280-fcrop64=1,005a2be2fe94af8a/1497545359319.jpg","MTA0ODM0MjYwODFa":"https://lh3.googleusercontent.com/--IiN64un-pM/WlaBUsfDQlI/AAAAAAAADXM/RO_4wizRBUkKMVWSyytQ2s_F15KyaN9ewCLcBGAs/s1280-fcrop64=1,000023d6f1979016/160831194832-01-best-of-bjork-restricted-super-169.jpg","NzU1NzY3OTky":"https://lh3.googleusercontent.com/-Q0CCuwsMAMI/VoTdrdtdByI/AAAAAAAAAFg/eaQY8R2-N9Y/s1280-fcrop64=1,010546c6ef2a9ede/JIM-CAMPBELL_Exploded-View.lo_%2Bcopy.jpg","NzQ3Nzc1MDExNFpa":"https://lh3.googleusercontent.com/-bPsMrDeS-gM/WbCOAaTKhpI/AAAAAAAAAAM/2g4wX3lDm0oFCKJpOSBpKgs-qUHEBiQOgCLcBGAs/s1280-fcrop64=1,00004c85ffffbfff/rain-room-by-random-instalation-homesdthetics-1.jpg","Mzk1ODY5MjA3OVpa":"https://lh3.googleusercontent.com/-_lTXywSv_K0/WHqTRY35FvI/AAAAAAAABpg/i7Tmr4Ql1-oAmHJ9xV2bZ_Ith1zCF3KfACLcB/s1280-fcrop64=1,000062bdff82c28e/static1.squarespace.jpg","MjEyNTAxNTI0N1pa":"https://lh3.googleusercontent.com/-1A6yhYyM2F8/V8jpTLC7HYI/AAAAAAAABNk/VxqRZs3gkLwbJSqAmsux-xVGX6bHpjXHgCLcB/s1280-fcrop64=1,00006c02ffffcdd1/Prototyping%2BHeader.jpg","MTg5Mzc2OTI3MVpa":"https://lh3.googleusercontent.com/-FmzBJ7W_o64/V4QIh-emt9I/AAAAAAAAA2I/gs4hnMHujuQZsX7SOGTRZAz4Cxw67ze9gCLcB/s1280-fcrop64=1,0ec247adf9ffa608/reactable_06-3.jpg","NzU1NjE3ODM0":"https://lh3.googleusercontent.com/-XIxeBqd6JJw/VoTaDI0Cw8I/AAAAAAAAAEM/zc7_EZmppyg/s1280-fcrop64=1,00004181ff4ccb4a/StoriesSell1%2Bcopy.jpg","NzE4Mzk5NDRa":"https://lh3.googleusercontent.com/-qHX3bRJvu-8/VhBGOMjRGDI/AAAAAAAAABc/mkBDD6b3Upk/s1280-fcrop64=1,00001b29fd417aa5/proto-anim-theme.png","MTE4NDg0MzY3":"https://lh3.googleusercontent.com/-HclBp9a8iOY/VhBE8M_WMRI/AAAAAAAAAA4/J7eeJA5b9F4/s1280-fcrop64=1,00006f1fffffc315/alexander-calder-mobile.jpg"};

function fetchImage(url) {
  return new Promise((resolve) => {
    const get = (u, redirects = 0) => {
      if (redirects > 3) return resolve(null);
      https.get(u, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          res.resume();
          return get(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) { res.resume(); return resolve(null); }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const mime = res.headers['content-type'] || 'image/jpeg';
          resolve(`data:${mime};base64,${Buffer.concat(chunks).toString('base64')}`);
        });
      }).on('error', () => resolve(null))
        .setTimeout(10000, function() { this.destroy(); resolve(null); });
    };
    get(url);
  });
}

async function main() {
  console.log('Reading snapshot…');
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));

  let matched = 0, downloaded = 0, skipped = 0, missing = 0;

  for (const course of snapshot.courses) {
    // Extract encoded ID from alternateLink
    const m = (course.alternateLink || '').match(/\/c\/([A-Za-z0-9_\-+=]+)/);
    const encodedId = m ? m[1] : null;
    const bannerUrl = encodedId ? BANNER_MAP[encodedId] : null;

    if (!bannerUrl) {
      missing++;
      console.log(`  ✗ No banner URL for: ${course.name}`);
      continue;
    }

    matched++;

    if (course._bannerDataUrl) {
      skipped++;
      console.log(`  ↷ Already has banner: ${course.name}`);
      continue;
    }

    process.stdout.write(`  ↓ Downloading banner for: ${course.name}… `);
    const dataUrl = await fetchImage(bannerUrl);
    if (dataUrl) {
      course._bannerDataUrl = dataUrl;
      downloaded++;
      console.log(`✓ (${Math.round(dataUrl.length / 1024)}KB)`);
    } else {
      console.log('✗ failed');
    }
  }

  console.log(`\nSummary: ${downloaded} downloaded, ${skipped} already present, ${missing} no URL found`);
  console.log('Writing updated snapshot…');
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2));
  console.log('✅ Done! Refresh your browser to see the banners.');
}

main().catch(e => { console.error(e); process.exit(1); });
