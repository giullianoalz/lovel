/**
 * The liability waiver, transcribed from the centre's current source document
 * (Liability Waiver LoveLearning.docx, provided 2026-08-07 — supersedes the
 * earlier "Love Camp Inc / Dael Martial Arts" paper form).
 *
 * This is the only copy. The parent's screen renders it by fetching it from
 * here, and the downloadable PDF is built from the same array — a signed waiver
 * that shows different wording than the one the parent read would be worthless
 * as a record, and two files inevitably drift.
 *
 * Editing the wording means bumping WAIVER_VERSION. Rows already signed keep
 * their own version, so an old signature never silently claims to cover text
 * that did not exist when it was given.
 */

export const WAIVER_VERSION = '2026-08-v2';

export const WAIVER_TITLE = 'Waiver and Release of Liability Form for Minor Children';

export const WAIVER_SECTIONS = [
  {
    heading: 'DISCLAIMER',
    paragraphs: [
      'The Love Camp is not responsible for any injury (or loss of property) to any person while participating in tutoring, educational programs, enrichment electives, special events, field trips, or any other activity offered by The Love Camp at 13555 Automobile Blvd., Suite 500, Clearwater, FL 33762 or any other location where The Love Camp conducts programming, for any reason whatsoever, including ordinary negligence on the part of its members, managers, agents, or employees.',
    ],
  },
  {
    heading: 'CONSENT',
    paragraphs: [
      'I consent to my/my minor\'s participation in the activity and acknowledge that I fully understand my/my minor\'s participation may involve risk of serious injury, illness, or death, including losses which may result not only from my/my minor\'s own actions, inactions, or negligence, but also from the actions, inactions, or negligence of others, the condition of the facilities, equipment, or areas where the activity is being conducted, and/or the rules of this type of activity. I understand that if I have any risk concerns, I shall discuss them completely with staff before I sign this agreement and before my/my minor\'s participation in the activity begins.',
      'Knowing and understanding the risks involved with participation in the activity, I hereby voluntarily and willingly assume full and complete responsibility for all losses and damages, including injury, illness, and death, resulting from my/my minor\'s participation in the activity, including transportation to and from the activity. I agree I am financially responsible for any losses and damages resulting from my/my minor\'s participation in the activity.',
    ],
  },
  {
    heading: 'WAIVER',
    paragraphs: [
      'In consideration for my/my minor\'s participation in the activity, I hereby waive all claims or causes of action, including ordinary negligence, against The Love Camp, its managers and members, and any of their employees, teachers, coaches, or agents, arising out of my/my minor\'s participation in the activity wherever, whenever, or however the same may occur.',
      'I understand this waiver is intended to be as broad and as inclusive as permitted by the laws of the State of Florida and agree that if any portion is held invalid, the remainder of the waiver will continue in full legal force and effect. I further agree that the venue for any legal proceedings shall be within the State of Florida.',
    ],
  },
  {
    heading: 'ENROLLMENT & PAYMENT COMMITMENT',
    paragraphs: [
      'I understand that after the one-week trial period, all classes require an 8-week enrollment commitment. If my child unenrolls before the 8-week term is complete, I understand that fees are not prorated and I remain responsible for the full 8-week commitment. I agree to pay all invoices in full within 30 days of the invoice due date.',
    ],
  },
  {
    heading: 'EXPECTATIONS',
    paragraphs: [
      'I understand the following agreement between myself and The Love Camp:',
    ],
    bullets: [
      'There is no guarantee my child\'s academic performance will improve. I must follow up on my child\'s academic work.',
      'The Love Camp will not be responsible for watching my child outside of scheduled program hours.',
      'I agree to pick up my child at the agreed hour. Failure to do so may disqualify my child from future activities.',
      'I understand that if I do not cancel before 24 hours of my scheduled time, I will lose that paid session.',
    ],
  },
  {
    heading: 'MEDICAL AUTHORIZATION',
    paragraphs: [
      'I give permission for The Love Camp\'s owners, officers, employees, and/or agents to seek emergency medical treatment for the participant(s) in the event they are unable to reach any parent or guardian. The undersigned also agrees that they themselves will be responsible for any financial debt incurred by said action.',
    ],
  },
  {
    heading: 'PHOTO & VIDEO RELEASE',
    paragraphs: [
      'I understand and agree that my/my minor\'s picture can be taken or filmed while participating in activities at The Love Camp or when representing The Love Camp at events. I hereby grant to The Love Camp, and its agents, employees, and photographers, the right to take, use, publish, and copyright photograph(s) and videos of me/my minor in press releases, advertisements, publications, and/or promotions of The Love Camp, including on The Love Camp\'s website and on social media platforms such as Facebook, Instagram, and YouTube, maintained by The Love Camp and/or its individual employees and/or agents. I hereby release and waive The Love Camp, and its agents, employees, photographers, and videographers, from any and all claims or demands arising out of or in connection with said photographs or videos or the publication of said photographs or videos.',
      'If you would like to not participate in photos, check the box below.',
    ],
  },
  {
    heading: 'AGREEMENT',
    paragraphs: [
      'I have read this form and fully understand that by signing this form, I am giving up legal rights and/or remedies which may be available to me/my minor for the ordinary negligence of The Love Camp or any person listed above. I affirm that I am of legal age and am freely signing this agreement.',
    ],
  },
];
