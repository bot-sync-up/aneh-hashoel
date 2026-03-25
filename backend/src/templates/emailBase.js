'use strict';

/**
 * Email Base Template
 *
 * פונקציה ליצירת תבנית HTML לאימייל עם עיצוב RTL, צבעי מותג ולחצני פעולה.
 * משמש את כל האימיילים היוצאים מהמערכת.
 *
 * צבעי מותג:
 *   כחול כהה (Navy)  — #1B2B5E
 *   זהב (Gold)       — #B8973A
 */

const BRAND_NAVY = '#1B2B5E';
const BRAND_GOLD = '#B8973A';

/**
 * יוצר כפתור פעולה ב-HTML.
 *
 * @param {{ label: string, url: string, color?: string }} button
 * @returns {string}  HTML של הכפתור
 */
function renderButton(button) {
  const bgColor = button.color || BRAND_GOLD;
  const textColor = bgColor === BRAND_GOLD ? BRAND_NAVY : '#ffffff';

  return `
    <a href="${button.url}"
       target="_blank"
       style="
         display: inline-block;
         padding: 12px 28px;
         margin: 6px 8px;
         background-color: ${bgColor};
         color: ${textColor};
         text-decoration: none;
         border-radius: 6px;
         font-size: 16px;
         font-weight: bold;
         font-family: 'Heebo', Arial, sans-serif;
         line-height: 1.4;
         mso-padding-alt: 0;
       ">
      ${button.label}
    </a>`;
}

/**
 * יוצר תבנית HTML מלאה לאימייל.
 *
 * @param {string}   title          כותרת האימייל (מוצגת בגוף המייל)
 * @param {string}   bodyContent    תוכן ה-HTML הפנימי
 * @param {Array<{ label: string, url: string, color?: string }>} [actionButtons]
 *   מערך כפתורי פעולה אופציונלי
 * @returns {string}  HTML מלא של האימייל
 */
function createEmailHTML(title, bodyContent, actionButtons = []) {
  const buttonsHTML = actionButtons.length > 0
    ? `
      <div style="
        text-align: center;
        padding: 24px 0 8px;
      ">
        ${actionButtons.map(renderButton).join('\n')}
      </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${title}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;700&display=swap');

    body {
      margin: 0;
      padding: 0;
      background-color: #f4f4f7;
      font-family: 'Heebo', Arial, sans-serif;
      direction: rtl;
      text-align: right;
      -webkit-text-size-adjust: 100%;
      -ms-text-size-adjust: 100%;
    }

    table {
      border-collapse: collapse;
      mso-table-lspace: 0pt;
      mso-table-rspace: 0pt;
    }

    img {
      border: 0;
      height: auto;
      line-height: 100%;
      outline: none;
      text-decoration: none;
      -ms-interpolation-mode: bicubic;
    }

    @media only screen and (max-width: 620px) {
      .container {
        width: 100% !important;
        padding: 0 12px !important;
      }
      .content-cell {
        padding: 20px 16px !important;
      }
    }
  </style>
</head>
<body style="margin:0; padding:0; background-color:#f4f4f7;">
  <!-- Outer wrapper -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
         style="background-color:#f4f4f7; padding: 24px 0;">
    <tr>
      <td align="center">
        <!-- Container -->
        <table role="presentation" class="container" width="580" cellpadding="0" cellspacing="0"
               style="max-width:580px; width:100%;">

          <!-- Header -->
          <tr>
            <td style="
              background-color: ${BRAND_NAVY};
              padding: 20px 32px;
              text-align: center;
              border-radius: 8px 8px 0 0;
            ">
              <div style="display:inline-block; background:#ffffff; border-radius:10px; padding:8px 16px; margin-bottom:10px;">
                <img
                  src="${(process.env.APP_URL || 'https://aneh.syncup.co.il').replace(/\/$/, '')}/logo.png"
                  alt="ענה את השואל"
                  width="110"
                  style="display:block; max-width:110px; height:auto;"
                />
              </div>
              <h1 style="
                margin: 0;
                color: ${BRAND_GOLD};
                font-size: 22px;
                font-weight: 700;
                font-family: 'Heebo', Arial, sans-serif;
                line-height: 1.3;
              ">ענה את השואל</h1>
            </td>
          </tr>

          <!-- Title bar -->
          <tr>
            <td style="
              background-color: ${BRAND_GOLD};
              padding: 14px 32px;
              text-align: center;
            ">
              <h2 style="
                margin: 0;
                color: ${BRAND_NAVY};
                font-size: 18px;
                font-weight: 700;
                font-family: 'Heebo', Arial, sans-serif;
                line-height: 1.3;
              ">${title}</h2>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td class="content-cell" style="
              background-color: #ffffff;
              padding: 32px;
              font-size: 15px;
              line-height: 1.7;
              color: #333333;
              font-family: 'Heebo', Arial, sans-serif;
              direction: rtl;
              text-align: right;
            ">
              ${bodyContent}
              ${buttonsHTML}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="
              background-color: ${BRAND_NAVY};
              padding: 20px 32px;
              text-align: center;
              border-radius: 0 0 8px 8px;
            ">
              <p style="
                margin: 0 0 4px;
                color: #a0a0b8;
                font-size: 12px;
                font-family: 'Heebo', Arial, sans-serif;
                line-height: 1.5;
              ">
                מייל זה נשלח ממערכת "ענה את השואל"
              </p>
              <p style="
                margin: 0;
                color: #a0a0b8;
                font-size: 12px;
                font-family: 'Heebo', Arial, sans-serif;
                line-height: 1.5;
              ">
                לשינוי העדפות התראות, ניתן לפנות למנהל המערכת
              </p>
            </td>
          </tr>

          <!-- SyncUp branding -->
          <tr>
            <td style="padding:10px 32px; text-align:center; background:#f0f0f0; border-radius:0 0 8px 8px;">
              <p style="margin:0; font-family:Arial,sans-serif; font-size:11px; color:#999; direction:rtl;">
                פותח ע"י <a href="https://syncup.co.il" style="color:#1B2B5E; text-decoration:none; font-weight:bold;">SyncUp</a> — טכנולוגיה שמניעה עסקים
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  createEmailHTML,
  BRAND_NAVY,
  BRAND_GOLD,
};
