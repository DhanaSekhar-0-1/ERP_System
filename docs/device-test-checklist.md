# Device test checklist (before the pilot)

Run this on a real Android phone with the **pilot APK** against the **hosted** server
([hosting guide](./hosting-guide.md), [APK guide](./android-apk-guide.md)). Tick each line; write
down anything odd with the time, the phone model and a screenshot.

Phone: ____________  Android version: ____  App version: ____  Date: ________

## Before you start (web, School Admin)

- [ ] Settings → Teacher check-in: school location, radius and late time saved.
- [ ] Settings → Modules in use: only the MVP1 parts on; "NFC card required" off.
- [ ] One class with a section, one test teacher (assigned as class teacher) and two test
      students registered. Keep their first passwords for the steps below.

## 1. Install and sign in

- [ ] The APK installs and opens; the icon and name are "School ERP".
- [ ] Server settings on the login screen shows the Render address.
- [ ] Teacher signs in with the **Teacher ID** and first password → asked to choose a new
      password → after that, the app opens.
- [ ] Wrong password shows a clear message.
- [ ] Closing and reopening the app keeps the teacher signed in.
- [ ] Tabs shown: Attendance and Leave only (no Subjects, no Notices).

## 2. Teacher check-in (at school)

- [ ] Away from school: check-in is refused with the distance.
- [ ] At school: the app asks for location permission once; check-in works and shows the time.
- [ ] A check-in after the late time shows **Late**.
- [ ] Check-out works; checking out twice is refused.
- [ ] On the web, Attendance → teachers today shows the same times.

## 3. Student attendance

- [ ] The teacher's section opens with the student list.
- [ ] Mark present/absent from the list and save; the web dashboard shows the same.
- [ ] Marking the same day again shows it as already marked.

## 4. NFC (when the reader is connected)

- [ ] Phone's own NFC (if it has one): holding a registered card marks the student; the same
      card again says "Already marked today"; an unknown card says it is not accepted.
- [ ] USB (OTG) reader: the Card ID box is selected when the scan screen opens; tapping a card
      types its number and marks the student without touching the screen; the next card works
      straight away.
- [ ] The number the USB reader types matches the number saved at registration (see "Card
      numbers must match" in the APK guide).

## 5. Leave

- [ ] Teacher requests a full day and a morning half day; both show as pending.
- [ ] Principal approves one on the web and rejects one with a reason; the phone shows both.
- [ ] Teacher cancels a pending request.

## 6. Student login

- [ ] Student signs in with the **admission number** and first password → must choose a new
      password.
- [ ] The student sees their own attendance only; no Results or Notices tab.
- [ ] Student leave request reaches the class teacher (web and phone).

## 7. Everyday conditions

- [ ] Mobile data instead of Wi-Fi works.
- [ ] Airplane mode: the app shows an error, not a blank screen or crash; works again when
      back online.
- [ ] After 20+ minutes idle (Render Free sleeps), the first action works within about a
      minute.
- [ ] Large-text setting on the phone: screens still readable.

Result: ☐ Ready for the pilot  ☐ Fix first: ____________________________________________
