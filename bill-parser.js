/* TNEB/TNPDCL bill parser — client-side, no username/password.
 * Handles text PDFs and image bills. Uses label-aware extraction, date-range
 * detection, meter-reading fallback, and field confidence so the app never
 * silently turns an unreadable field into zero.
 */
(function(){
  const U=window.SolarApp=window.SolarApp||{};
  const Parser={};
  U.BillParser=Parser;
  // Stable global alias so cached/older app.js files cannot lose the parser namespace.
  window.TNEBBillParser=Parser;
  const clean=s=>String(s||'').replace(/\u00a0/g,' ').replace(/[|¦]+/g,' ').replace(/[ \t]+/g,' ').trim();
  const num=s=>{const m=String(s||'').replace(/,/g,'').match(/-?\d+(?:\.\d+)?/);return m?Number(m[0]):null;};
  const dateRx='\\d{1,2}[\\/-]\\d{1,2}[\\/-]\\d{2,4}';
  function parseDate(s){if(!s)return '';const m=String(s).match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);if(!m)return '';let y=Number(m[3]);if(y<100)y+=2000;return `${y}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;}
  function dateToTime(s){const d=parseDate(s);return d?new Date(d+'T00:00:00').getTime():NaN;}
  function periodFromText(text){
    const m=String(text).match(new RegExp('('+dateRx+')\\s*(?:-|–|—|to)\\s*('+dateRx+')','i'));
    if(!m)return {text:'',start:'',end:'',months:null};
    const start=parseDate(m[1]),end=parseDate(m[2]);
    let months=null;const a=dateToTime(start),b=dateToTime(end);
    if(Number.isFinite(a)&&Number.isFinite(b)){months=Math.max(1,Math.round((b-a)/(1000*60*60*24*30.4375)));if(months<1)months=1;}
    if(months===1 && /(?:bi[- ]?monthly|two\s*months|2\s*months)/i.test(text))months=2;
    return {text:`${m[1]} - ${m[2]}`,start,end,months};
  }
  function findAfterLabel(text, labels, maxChars=120){
    const src=String(text);
    for(const label of labels){
      const re=new RegExp(label+'\\s*(?:[:#=.-]|\\s)*([^\\n]{0,'+maxChars+'})','i');
      const m=src.match(re); if(m&&clean(m[1])) return clean(m[1]);
    }
    return '';
  }
  function findNumberAfterLabel(text, labels, maxChars=120){
    const v=findAfterLabel(text,labels,maxChars); return num(v);
  }
  function firstMatch(text, patterns){for(const p of patterns){const m=text.match(p);if(m)return clean(m[1]||m[0]);}return '';}
  function numberNearLabels(text, labels){
    for(const label of labels){
      const re=new RegExp(label+'[^\\n]{0,90}?([0-9][0-9,]*(?:\\.[0-9]+)?)','i');
      const m=text.match(re); if(m){const n=num(m[1]);if(n!==null)return n;}
    }
    return null;
  }
  function normalizeOCR(text){
    return String(text||'').replace(/\r/g,'\n').replace(/[“”]/g,'"').replace(/[‘’]/g,"'").replace(/[₹]/g,' ₹ ').replace(/[‐‑‒–—]/g,'-').replace(/\u00a0/g,' ');
  }
  function extract(text, filename){
    text=normalizeOCR(text);
    const period=periodFromText(text);
    const consumer=firstMatch(text,[
      /(?:consumer|service|connection)\s*(?:no\.?|number|id)\s*[:#=.-]?\s*([0-9A-Z][0-9A-Z\/-]{5,})/i,
      /(?:consumer\s*no|service\s*no|consumer\s*number)\s*[:#=.-]?\s*([0-9A-Z\/-]{5,})/i
    ]);
    const name=findAfterLabel(text,['(?:consumer|customer)\\s*name','name\\s*of\\s*consumer'],90).replace(/\s+(?:tariff|category|service|consumer|meter)\b.*$/i,'').trim();
    const address=findAfterLabel(text,['(?:communication|service|billing|correspondence)?\\s*address','address\\s*of\\s*consumer'],180).replace(/\\s+(?:tariff|category|consumer|service\\s*no|meter)\\b.*$/i,'').trim();
    const pincode=(text.match(/(?:pin(?:code)?|zip)\\s*[:#=.-]?\\s*(\\d{6})/i)||text.match(/\\b(6\\d{5})\\b/))?.[1]||'';
    const city=findAfterLabel(text,['city','town'],60).replace(/\\s+(?:district|state|pin(?:code)?)\\b.*$/i,'').trim();
    const district=findAfterLabel(text,['district'],60).replace(/\\s+(?:state|pin(?:code)?)\\b.*$/i,'').trim();
    const tariff=findAfterLabel(text,['tariff(?:\\s*category)?','category(?:\\s*of\\s*service)?'],70).replace(/\s+(?:meter|load|units?|bill|amount)\b.*$/i,'').trim();
    const meter=firstMatch(text,[/(?:meter)\s*(?:no\.?|number|id)\s*[:#=.-]?\s*([0-9A-Z\/-]{3,})/i]);
    let sanctioned=numberNearLabels(text,['sanctioned\\s*load','sanctioned\\s*load\\s*kw']);
    let connected=numberNearLabels(text,['connected\\s*load','connected\\s*load\\s*kw']);
    if(sanctioned!==null && sanctioned>100) sanctioned=null;
    if(connected!==null && connected>100) connected=null;
    const prev=numberNearLabels(text,['previous(?:\\s*meter)?(?:\\s*reading)?','prev(?:ious)?\\s*reading','previous\\s*reading']);
    const curr=numberNearLabels(text,['current(?:\\s*meter)?(?:\\s*reading)?','present(?:\\s*reading)?','current\\s*reading']);
    let units=numberNearLabels(text,[
      'units?\\s*(?:consumed|consumption)', 'energy\\s*(?:consumed|consumption)',
      'consumption\\s*(?:in\\s*)?(?:units?|kwh)', 'units?\\s*charged',
      '(?:units?|kwh)\\s*consumed', 'total\\s*units?'
    ]);
    if(units===null) units=numberNearLabels(text,['units?']);
    if(units===null && prev!==null && curr!==null && curr>=prev) units=curr-prev;
    // Guard against OCR accidentally selecting money/service numbers as units.
    if(units!==null && (units<0 || units>1000000)) units=null;
    let amount=numberNearLabels(text,[
      'total\\s*(?:current\\s*)?(?:bill|amount)', 'total\\s*amount\\s*payable',
      'amount\\s*payable','net\\s*(?:payable|amount)','current\\s*bill',
      'bill\\s*amount','payable\\s*amount','net\\s*payable\\s*amount'
    ]);
    if(amount===null){ const cm=text.match(/(?:₹|rs\\.?|inr)\\s*([0-9][0-9,]*(?:\\.[0-9]+)?)/i); if(cm) amount=num(cm[1]); }
    const billDateRaw=firstMatch(text,[new RegExp('(?:bill|issue|date\\s*of\\s*bill)\\s*date?\\s*[:#=.-]?\\s*('+dateRx+')','i'),new RegExp('(?:bill\\s*date|issue\\s*date)\\s*[:#=.-]?\\s*('+dateRx+')','i')]);
    const dueRaw=firstMatch(text,[new RegExp('due\\s*date\\s*[:#=.-]?\\s*('+dateRx+')','i')]);
    const billDate=parseDate(billDateRaw), dueDate=parseDate(dueRaw);
    let periodMonths=period.months || (/bi[- ]?monthly|two\s*months|2\s*months/i.test(text)?2:1);
    if(periodMonths>6) periodMonths=2;
    const billingCycle=periodMonths===2?'Bimonthly':(periodMonths===1?'Monthly':'Unknown');
    const fields={consumerNumber:!!consumer,name:!!name,address:!!address,tariffCategory:!!tariff,meterNumber:!!meter,sanctionedLoadKW:sanctioned!==null,connectedLoadKW:connected!==null,units:units!==null,billAmount:amount!==null,billDate:!!billDate,dueDate:!!dueDate,billingPeriod:!!period.text};
    const score=Math.round(Object.values(fields).filter(Boolean).length/Object.keys(fields).length*100);
    const warnings=[];
    if(units===null)warnings.push('Energy units were not confidently detected. Upload a clear bill PDF/image; the app will not guess units from the bill amount.');
    if(amount===null)warnings.push('Bill amount was not confidently detected.');
    if(!consumer)warnings.push('Consumer/service number was not detected.');
    return {
      sourceFile:filename||'',consumerNumber:consumer,name,address,city,district,pincode,tariffCategory:tariff,meterNumber:meter,
      sanctionedLoadKW:sanctioned,connectedLoadKW:connected,units,billAmount:amount,
      billDate,dueDate,billingPeriod:period.text,billingCycle,periodMonths,
      periodStart:period.start,periodEnd:period.end,previousReading:prev,currentReading:curr,
      confidence:score,fieldConfidence:fields,warnings,rawText:text
    };
  }
  function setProgress(msg){const e=document.getElementById('tnebBillParseProgress');if(e)e.textContent=msg;}
  async function pdfText(file){
    if(!window.pdfjsLib)throw new Error('PDF reader is not loaded. Please refresh the page and try again.');
    const buf=await file.arrayBuffer();
    const pdf=await window.pdfjsLib.getDocument({data:buf}).promise;
    let out='';
    for(let i=1;i<=pdf.numPages;i++){
      setProgress(`Reading PDF page ${i} of ${pdf.numPages}…`);
      const page=await pdf.getPage(i);const c=await page.getTextContent();
      out+='\n'+c.items.map(x=>x.str).join(' ');
    }
    return {text:out,pdf};
  }
  async function ocrImage(source,label='bill image'){
    if(!window.Tesseract)throw new Error('OCR engine is not loaded. Check your internet connection and refresh the page.');
    setProgress(`OCR reading ${label}… 0%`);
    const r=await window.Tesseract.recognize(source,'eng',{
      logger:m=>{const e=document.getElementById('tnebBillParseProgress');if(e&&typeof m.progress==='number')e.textContent=`OCR reading ${label}… ${Math.round(m.progress*100)}%`;}
    });
    return r.data?.text||'';
  }
  async function pdfOCR(pdf){
    let out='';
    const maxPages=Math.min(pdf.numPages,6);
    for(let i=1;i<=maxPages;i++){
      setProgress(`OCR reading PDF page ${i} of ${maxPages}…`);
      const page=await pdf.getPage(i);
      const viewport=page.getViewport({scale:1.7});
      const canvas=document.createElement('canvas');
      canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      const ctx=canvas.getContext('2d',{willReadFrequently:true});
      await page.render({canvasContext:ctx,viewport}).promise;
      out+='\n'+await ocrImage(canvas,`PDF page ${i}`);
      canvas.width=canvas.height=1;
    }
    return out;
  }
  Parser.parseFile=async function(file){
    if(!file)throw new Error('Select a TNEB/TNPDCL bill PDF or image.');
    const type=file.type||'';
    const isPdf=type==='application/pdf'||/\.pdf$/i.test(file.name);
    let text='';
    let pdf=null;
    if(isPdf){
      const parsed=await pdfText(file); text=parsed.text||''; pdf=parsed.pdf;
      // Many TNPDCL bills are scanned/image-only PDFs. If the PDF has no text,
      // or the text does not contain enough utility fields, render pages and OCR them.
      let quick=extract(text,file.name);
      const needsOCR=!text.trim() || !quick.consumerNumber || quick.units===null || quick.billAmount===null;
      if(needsOCR && pdf){
        const ocr=await pdfOCR(pdf);
        if(ocr.trim()) text=(text+'\n'+ocr).trim();
      }
    }else{
      text=await ocrImage(file,'bill image');
    }
    if(!text.trim())throw new Error('No readable text was found. Upload the original TNEB/TNPDCL PDF or a clear, straight, high-resolution bill image.');
    const result=extract(text,file.name);
    result.extractedTextLength=text.length;
    const missing=[];
    if(!result.consumerNumber)missing.push('consumer/service number');
    if(result.units===null)missing.push('units');
    if(result.billAmount===null)missing.push('bill amount');
    result.missingRequired=missing;
    if(missing.length)result.warnings=[...(result.warnings||[]),`Required bill fields not confidently detected: ${missing.join(', ')}.`];
    return result;
  };
  Parser.extractText=extract;
})();
