#!/usr/bin/env python3
"""Sample receipts, e-invoices and bills for testing ClaimPack. All names are fictional."""
import random, math
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib import colors
random.seed(7)
import pathlib
OUT=str(pathlib.Path(__file__).resolve().parent.parent/"samples")+"/"
F="/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"; FB="/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"
def font(sz,b=False): return ImageFont.truetype(FB if b else F,sz)
def thermal(name, lines, w=560):
    h=60+len(lines)*34+120
    im=Image.new("L",(w,h),246); d=ImageDraw.Draw(im); y=30
    for ln in lines:
        if isinstance(ln,tuple): t,kind=ln
        else: t,kind=ln,""
        f=font(30 if kind=="big" else 22, kind in("b","big"))
        tw=d.textlength(t,font=f)
        x=(w-tw)/2 if kind in("c","big","b") else 24
        if kind=="r": x=w-24-tw
        d.text((x,y),t,font=f,fill=random.randint(25,60)); y+=40 if kind=="big" else 32
    # qr-ish block
    for i in range(0,120,8):
        for j in range(0,120,8):
            if random.random()<.5: d.rectangle([w/2-60+i,y+10+j,w/2-60+i+7,y+17+j],fill=30)
    im=im.filter(ImageFilter.GaussianBlur(.6))
    # photo on a desk: tilt, background, shading
    bg=Image.new("RGB",(int(w*1.35),int(h*1.18)),(118,96,72)); dd=ImageDraw.Draw(bg)
    for k in range(0,bg.height,5): dd.line([(0,k),(bg.width,k+random.randint(-3,3))],fill=(110+random.randint(-8,8),90+random.randint(-6,6),66))
    rc=im.convert("RGB").rotate(random.uniform(-4,4),expand=True,fillcolor=(118,96,72))
    bg.paste(rc,((bg.width-rc.width)//2,(bg.height-rc.height)//2))
    shade=Image.linear_gradient("L").resize(bg.size).point(lambda v:200+v//5)
    bg=Image.composite(bg,Image.new("RGB",bg.size,(40,30,20)),shade)
    bg.save(OUT+name,quality=88)
def einvoice(name, supplier, addr, inv_no, uuid, date, desc, qty, unit, total, pages=1, title="E-INVOICE"):
    c=canvas.Canvas(OUT+name,pagesize=A4); W,H=A4
    for pg in range(pages):
        c.setFillColor(colors.HexColor("#1F4E79")); c.rect(40,H-95,46,46,fill=1,stroke=0)
        c.setFillColor(colors.white); c.setFont("Helvetica-Bold",18); c.drawCentredString(63,H-78,supplier[0])
        c.setFillColor(colors.black); c.setFont("Helvetica-Bold",9); c.drawString(96,H-58,supplier.upper())
        c.setFont("Helvetica",7.5)
        for i,a in enumerate(addr): c.drawString(96,H-70-i*9,a)
        for i in range(0,50,5):
            for j in range(0,50,5):
                if random.random()<.5: c.rect(W-95+i,H-100+j,5,5,fill=1,stroke=0)
        c.setFont("Helvetica-Bold",12); c.drawCentredString(W/2,H-130,title)
        c.setFont("Helvetica",7.5)
        rows=[("Supplier TIN:","C21000000010","E-Invoice Type and Version:","Invoice Version 1"),("Supplier Reg/IC No:","201901000001","E-Invoice No:",inv_no),
              ("Supplier SST ID:","NA","UUID:",uuid),("Supplier MSIC Code:","47300","Issued Date and Time:",date+" 10:21:19")]
        for i,(a,b,cc,dd) in enumerate(rows):
            y=H-160-i*11; c.drawString(40,y,a); c.drawString(140,y,b); c.drawString(310,y,cc); c.drawString(420,y,dd)
        c.line(40,H-215,W-40,H-215)
        buyer=[("Buyer Name:","SAMPLE CONSULTANTS SDN BHD"),("Buyer TIN:","C99000000020"),("Buyer Address:","Lot 1, Jalan Contoh, 88000 Kota Kinabalu, Sabah"),("Buyer Email:","accounts@example.com")]
        for i,(a,b) in enumerate(buyer): c.drawString(40,H-235-i*11,a); c.drawString(140,H-235-i*11,b)
        c.drawString(310,H-235,"Currency Code: MYR")
        y=H-300; c.setFont("Helvetica-Bold",7.5)
        for x,t in [(40,"Description"),(260,"Class"),(300,"Qty"),(340,"Unit Price"),(400,"Amount"),(450,"Tax %"),(500,"Total")]: c.drawString(x,y,t)
        c.line(40,y-4,W-40,y-4); c.setFont("Helvetica",7.5); y-=16
        if pg==0:
            for x,t in [(40,desc),(260,"022"),(300,qty),(340,unit),(400,f"{total:.2f}"),(450,"0.00"),(500,f"{total:.2f}")]: c.drawString(x,y,t)
            yy=H-380
            for i,(a,b) in enumerate([("Total Excluding Tax:",total),("Total Tax Amount:",0),("Total Including Tax:",total),("Rounding:",0),("Total Payable Amount:",total)]):
                c.setFont("Helvetica-Bold",7.5); c.drawString(380,yy-i*11,a); c.drawRightString(W-40,yy-i*11,f"{b:.2f}")
            c.setFont("Helvetica",7); c.drawString(40,H-470,f"Date and Time of Validation: {date} 10:21:23")
        else:
            c.drawString(40,y,"Usage details (continued) - itemised calls and data sessions")
            for i in range(30): c.drawString(40,y-14-i*11,f"{date}  {random.randint(10,23):02d}:{random.randint(0,59):02d}  01{random.randint(10000000,99999999)}  {random.randint(1,40)} min  0.00")
        c.setFont("Helvetica",6.5); c.drawRightString(W-40,30,f"Page {pg+1} of {pages}")
        c.showPage()
    c.save()
fuel=[("2026-09-02","02/09/2026","31.779","4.72",150.00,"12456312"),("2026-09-07","07/09/2026","21.413","4.67",100.00,"F10272-202609-IV-dd9973"),
      ("2026-09-12","12/09/2026","32.520","4.92",160.00,"21136520"),("2026-09-16","16/09/2026","32.520","4.92",160.00,"12467090"),
      ("2026-09-25","25/09/2026","22.770","5.27",120.00,"12474515"),("2026-09-30","30/09/2026","22.140","5.42",120.00,"12480486")]
for i,(iso,d,l,p,amt,inv) in enumerate(fuel,1):
    st="SINAR FUEL KM25 JLN TUARAN" if i!=2 else "PS BUKIT INDAH (CONTOH TRADING)"
    thermal(f"fuel_{i:02d}_receipt.jpg",[(st,"b"),("TUARAN, SABAH","c"),("INVOICE","big"),f"Date: {d}  Time: 10:{10+i:02d}",f"Inv No: {inv}","Pump: 06   Cashier: A01","-"*36,"Diesel Euro 5",f"  {l} L x RM {p}",("RM %.2f"%amt,"r"),"-"*36,("TOTAL  RM %.2f"%amt,"b"),"CASH                RM %.2f"%amt,"Scan for e-Invoice within 3 days"])
    einvoice(f"fuel_{i:02d}_einvoice.pdf",st.title(),["Tuaran Service Station","88450 Tuaran, Sabah"],inv,"ZP6W70KBFEVWJG3PKKJYP1M"+str(i),iso,"Diesel Euro 5",l,p,amt)
thermal("toll_01_receipt.jpg",[("PARKING KK CITY","b"),("SITE OFFICE CARPARK","c"),"Date: 18/09/2026  09:02","Ticket: 7781203","Entry 08:10  Exit 17:45",("TOTAL RM 12.00","b"),"Thank you"])
thermal("misc_01_receipt.jpg",[("CETAK PANTAS SDN BHD","b"),("Printing & Binding","c"),"Date: 22/09/2026","Receipt: CP-55120","A1 drawings plot x 12   RM 36.00","Binding x 2            RM 9.00",("TOTAL RM 45.00","b")])
einvoice("telco_01_bill.pdf","Contoh Mobile Berhad",["Mobile postpaid bill","50450 Kuala Lumpur"],"BILL-0926-88123","UUID-TELCO-9921","2026-09-28","Postpaid plan Sep 2026","1","98.00",98.00,pages=2,title="BILL / E-INVOICE")
einvoice("hotel_01_invoice.pdf","Hotel Teluk Contoh",["Jalan Pantai, 90000 Sandakan","Sabah"],"HTC-26-04471","UUID-HOTEL-4471","2026-09-24","Deluxe room 2 nights (23-25 Sep)","2","165.00",330.00,title="TAX INVOICE / E-INVOICE")
# an "other" support: approval memo image
im=Image.new("RGB",(1240,1754),"white"); d=ImageDraw.Draw(im)
d.text((100,120),"MEMO - APPROVAL FOR OUTSTATION TRAVEL",font=font(34,True),fill="black")
for i,t in enumerate(["To: Project Director","From: Resident Engineer","Date: 20/09/2026","","Request approval to attend the coordination meeting","at the regional office, Sandakan, 23-25 September 2026.","","Approved:  ______________________"]): d.text((100,240+i*52),t,font=font(28),fill="black")
im.save(OUT+"hotel_01_approval.jpg",quality=85)
print("ok")
