/**
 * One-off, round 4: full audit of all 268 active TutorBird students against
 * the app roster. Rounds 1-3 covered the "online"/"homeschool" tags; this
 * covers everything else (Love Camp, Love Learning FL LLC, Fall/Spring/
 * Summer cohorts, Lunch and Social Time, Naomi's Classes, Erica's Private
 * Tutoring, and students with no group tag at all).
 *
 * Skipped deliberately (flagged for manual review, not auto-created):
 *  - Doucett, Timothy / Kah, Felipe: adult students, TutorBird has no
 *    contact info (no email/phone) to import.
 *  - Playford, Luna: no email/phone on the TutorBird contact either.
 *  - Simpson, Aria / Simpson, Leona: TutorBird lists them under the Brooks
 *    family contact, but the app already has an unrelated "Aria Simpson"
 *    PARENT record in "Brooks Family" from an earlier import — creating
 *    students here risks tangling two different people under one family.
 *
 * Usage:
 *   node scripts/add-tutorbird-full-audit-4.mjs          (dry run)
 *   node scripts/add-tutorbird-full-audit-4.mjs --apply
 */

import 'dotenv/config';
import prisma from '../src/config/database.js';
import { placeholderUid } from '../src/services/invite.service.js';

const apply = process.argv.includes('--apply');

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

const families = [
  { familyName: 'Adkisson Family', parent: { name: 'Holly Adkisson', email: 'mrsadkisson@gmail.com', phone: '618-694-4847' }, students: [{ name: 'Caroline Adkisson', email: null, age: 14 }] },
  { familyName: 'Slattery Family', parent: { name: 'Amanda Slattery', email: 'amanda.slatt04@gmail.com', phone: '727-743-9215' }, students: [{ name: 'Raiden Albritton', email: null, age: 16 }] },
  { familyName: 'Clark-Aleman Family', parent: { name: 'Maria Clark', email: 'mariakc723@gmail.com', phone: '727-275-4647' }, students: [{ name: 'Camryn Aleman', email: null, age: 8 }, { name: 'Elijah Aleman', email: null, age: 6 }] },
  { familyName: 'Ambrose Family', parent: { name: 'Tina Ambrose', email: 'tinav68@hotmail.com', phone: '215-948-2121' }, students: [{ name: 'Sabrina Ambrose', email: null, age: null }] },
  { familyName: 'Thivener Family', parent: { name: 'Stephanie Thivener', email: 'stephaniethivener@yahoo.com', phone: '727-518-4085' }, students: [{ name: 'Kennady Anderson', email: 'kennadyanderson@yahoo.com', age: 16 }] },
  { familyName: 'Estrada Family', parent: { name: 'Lisette Estrada', email: 'guayabayqueso@gmail.com', phone: '614-323-5003' }, students: [{ name: 'Gabriela Baldwin', email: 'gabibschool@gmail.com', age: 21 }] },
  { familyName: 'Ballard Family', parent: { name: 'Brenda Ballard', email: 'brendatballard@gmail.com', phone: '813-401-4435' }, students: [{ name: 'Kailani Ballard', email: null, age: 13 }] },
  { familyName: 'Barnett Family', parent: { name: 'Natalie Barnett', email: 'Wagner2@mail.usf.edu', phone: '727-482-4324' }, students: [{ name: 'Lilah Barnett', email: null, age: 17 }] },
  { familyName: 'Barthelmes Family', parent: { name: 'Autumn Barthelmes', email: 'autumnorwig@yahoo.com', phone: '727-458-1556' }, students: [{ name: 'Cloey Barthelmes', email: 'cloeyb0303@gmail.com', age: 18 }] },
  { familyName: 'Bates Family', parent: { name: 'Maria Bates', email: 'maria@mariatbates.com', phone: '727-641-9686' }, students: [{ name: 'Marcus Bates', email: null, age: null }] },
  { familyName: 'Bayless Family', parent: { name: 'Diana Bayless', email: 'dmcfall15@yahoo.com', phone: '770-842-5153' }, students: [{ name: 'Josh Bayless', email: null, age: 13 }] },
  { familyName: 'Bird Family', parent: { name: 'Gina Bird', email: 'gina@birdballproductions.com', phone: '813-727-6825' }, students: [{ name: 'Juliet Bird', email: null, age: 7 }] },
  { familyName: 'Brandon Family', parent: { name: 'Julie Brandon', email: 'jlcain_23@yahoo.com', phone: '857-526-6243' }, students: [{ name: 'Emma Brandon', email: null, age: 14 }] },
  { familyName: 'Cooper-Buser Family', parent: { name: 'Tessa Cooper', email: 'mavineeb7@gmail.com', phone: '727-495-4746' }, students: [{ name: 'Mavinee Buser', email: null, age: 11 }] },
  { familyName: 'Campo Family', parent: { name: 'Diana Campo', email: 'campo.steve72@yahoo.com', phone: '727-226-4094' }, students: [{ name: 'Isabella Campo', email: 'bellegirl09@gmail.com', age: 16 }] },
  { familyName: 'Cassell Family', parent: { name: 'Ruth Cassell', email: 'rcassel05@gmail.com', phone: '614-753-1792' }, students: [{ name: 'Elijah Cassell', email: null, age: 8 }] },
  { familyName: 'Ortiz-Castro Family', parent: { name: 'Tamara Ortiz', email: 't.ortiz86@yahoo.com', phone: '845-532-6737' }, students: [{ name: 'Tara Castro', email: null, age: 12 }] },
  { familyName: 'Costello Family', parent: { name: 'Carolyn Costello', email: 'carolyn919@hotmail.com', phone: '727-741-6855' }, students: [{ name: 'Madison Costello', email: 'mcostello4545@gmail.com', phone: '727-400-5332', age: null }] },
  { familyName: 'Crisp Family', parent: { name: 'Claire Crisp', email: 'clairedcrisp@gmail.com', phone: '864-608-2745' }, students: [{ name: 'Brayton Crisp', email: null, age: 13 }] },
  { familyName: 'Cruz Family', parent: { name: 'Keisy Cruz', email: 'keisy0319@gmail.com', phone: '386-837-8347' }, students: [{ name: 'Keilianys Cruz', email: null, age: 11 }] },
  { familyName: 'Clark-Cuozzo Family', parent: { name: 'Natalie Clark', email: 'natalie.rose.alfano@gmail.com', phone: '617-827-1851' }, students: [{ name: 'Samuel Cuozzo', email: null, age: 19 }] },
  { familyName: 'Dalto Family', parent: { name: 'Kerry Dalto', email: 'kerrydasilva@gmail.com', phone: '917-553-8906' }, students: [{ name: 'Alex Dalto', email: null, age: 11 }] },
  { familyName: 'De La Nuez Family', parent: { name: 'Mayelin De La Nuez', email: 'Raulmaye@yahoo.com', phone: '818-415-9130' }, students: [{ name: 'Benjamin De La Nuez', email: 'Bendelanuez@gmail.com', age: 4 }] },
  { familyName: 'Dedoussis Family', parent: { name: 'Amy Dedoussis', email: 'amydedoussis@gmail.com', phone: '415-724-1210' }, students: [{ name: 'Athena Dedoussis', email: null, age: 11 }, { name: 'Sebastian Dedoussis', email: null, age: 13 }] },
  { familyName: 'DiPiazza Family', parent: { name: 'Aerielle DiPiazza', email: 'adipiazza618@gmail.com', phone: '646-346-4857' }, students: [{ name: 'Ocean DiPiazza', email: null, age: 8 }] },
  { familyName: 'Deniz-Dorsey Family', parent: { name: 'Jacara Deniz', email: 'jdennis2911@gmail.com', phone: '727-310-6781' }, students: [{ name: 'Jeremiah Dorsey', email: null, age: 13 }] },
  { familyName: 'Dulany Family', parent: { name: 'Sonya Dulany', email: 'sonyafl@yahoo.com', phone: '602-469-3023' }, students: [{ name: 'Colton Dulany', email: 'coltondulany@gmail.com', age: 16 }] },
  { familyName: 'Duncan-Thayer Family', parent: { name: 'Lisa Duncan-Thayer', email: 'duncan.lisa@gmail.com', phone: '813-842-8192' }, students: [{ name: 'Serena Duncan-Thayer', email: null, age: 16 }] },
  { familyName: 'Remo-Ebarb Family', parent: { name: 'Panacea Remo', email: 'artistrybypanacea@gmail.com', phone: '903-436-2448' }, students: [{ name: 'Athlyn Ebarb', email: null, age: 8 }] },
  { familyName: 'Edwards Family (Leetron)', parent: { name: 'Leetron Edwards', email: 'leetron44edwards@yahoo.com', phone: '786-376-5498' }, students: [{ name: 'Leetron Edwards Jr', email: null, age: 20 }] },
  { familyName: 'Falciglia Family', parent: { name: 'Melissa Falciglia', email: 'thomasmelissa2626@gmail.com', phone: '727-637-5283' }, students: [{ name: 'Levi Falciglia', email: null, age: 7 }] },
  { familyName: 'Flemming Family', parent: { name: 'Latrese Flemming', email: 'trese245@gmail.com', phone: '904-338-2572' }, students: [{ name: 'LaTroy Fleming Jr', email: null, age: 11 }] },
  { familyName: 'Franke Family', parent: { name: 'Jennifer Franke', email: 'frankej1@outlook.com', phone: '727-286-0558' }, students: [{ name: 'Marion Franke', email: null, age: null }] },
  { familyName: 'Furney Family', parent: { name: 'Julie Furney', email: 'furney4@gmail.com', phone: '727-599-4740' }, students: [{ name: 'Hope Furney', email: null, age: null }] },
  { familyName: 'Garnett Family', parent: { name: 'Tanya Garnett', email: 'tanyagarnett1@gmail.com', phone: '386-589-3558' }, students: [{ name: 'Elijah Garnett', email: null, age: null }] },
  { familyName: 'Gil Family', parent: { name: 'Gustavo Gil', email: 'Visionarygustavo@gmail.com', phone: '347-884-0365' }, students: [{ name: 'Etukai Gil', email: null, age: 12 }] },
  { familyName: 'Gill Family', parent: { name: 'Suzy Gill', email: 'Csschock@gmail.com', phone: '720-936-7953' }, students: [{ name: 'Isabella Gill', email: null, age: 6 }] },
  { familyName: 'Goff Family', parent: { name: 'Ronaldo Goff', email: 'Rongoff82@gmail.com', phone: '802-673-4549' }, students: [{ name: 'Khloe Goff', email: null, age: 16 }, { name: 'Maya Goff', email: null, age: 9 }, { name: 'Quinn Goff', email: null, age: 14 }] },
  { familyName: 'Goudelock Family', parent: { name: 'Sarah Goudelock', email: 'sfagerlee@yahoo.com', phone: '209-403-8883' }, students: [{ name: 'Grace Goudelock', email: null, age: 15 }] },
  { familyName: 'Healy Family', parent: { name: 'Amber Healy', email: 'nunn.amber@yahoo.com', phone: '716-316-8377' }, students: [{ name: 'Paisley Healy', email: null, age: 7 }] },
  { familyName: 'Mihos-Hegberg Family', parent: { name: 'Irene Mihos', email: 'imihos723@gmail.com', phone: '718-576-8449' }, students: [{ name: 'Brock Hegberg', email: null, age: 13 }] },
  { familyName: 'Holmstrom Family', parent: { name: 'Hannah Holmstrom', email: 'Hannah.Holmstrom@cru.org', phone: '772-404-2533' }, students: [{ name: 'Genevieve Holmstrom', email: null, age: 10 }] },
  { familyName: 'Hunnewell Family', parent: { name: 'Heather Hunnewell', email: 'Hhunnewell@gmail.com', phone: '813-520-5042' }, students: [{ name: 'Colton Hunnewell', email: null, age: 15 }, { name: 'Faith Hunnewell', email: null, age: 14 }] },
  { familyName: 'Iglesias Family', parent: { name: 'Barbara Iglesias', email: 'breemahree@icloud.com', phone: '352-530-9823' }, students: [{ name: "Jah'Kobe Iglesias", email: null, age: 7 }] },
  { familyName: 'Jerichow Family', parent: { name: 'Amberly Jerichow', email: 'Amberly1006@yahoo.com', phone: '727-251-5757' }, students: [{ name: 'Jacob Jerichow', email: null, age: 12 }] },
  { familyName: 'Julian Family (Julie)', parent: { name: 'Julie Julian', email: 'julosh412@gmail.com', phone: '727-656-5150' }, students: [{ name: 'Isabella Julian', email: null, age: 13 }] },
  { familyName: 'Kennedy Family', parent: { name: 'Erica Kennedy', email: 'ericalynnkennedy@gmail.com', phone: '727-307-7251' }, students: [{ name: 'Caiden Kennedy', email: null, age: 10 }] },
  { familyName: 'Kiley Family', parent: { name: 'Laura Kiley', email: 'laurakiley@me.com', phone: '561-758-5799' }, students: [{ name: 'Meimei and Yuiyui Kiley', email: null, age: null }] },
  { familyName: 'Koch Family', parent: { name: 'Constance Koch', email: 'jaesyaya52@gmail.com', phone: '610-737-1732' }, students: [{ name: 'Jaelynn Koch', email: null, age: 15 }] },
  { familyName: 'Konovalchuk Family', parent: { name: 'Veronica Konovalchuk', email: 'verchek@gmail.com', phone: '916-450-1040' }, students: [{ name: 'Manuela Konovalchuk', email: null, age: 6 }] },
  { familyName: 'El Bouab-Laqlalech Family', parent: { name: 'Aicha el bouab', email: 'Aichaelbouab@gmail.com', phone: '813-900-1281' }, students: [{ name: 'Adam Laqlalech', email: 'adamlaqlalech1@gmail.com', age: null }, { name: 'Salma Laqlalech', email: null, age: 15 }] },
  { familyName: 'Medina-Llanes Family', parent: { name: 'Ximena Medina', email: 'hllanes3@gmail.com', phone: '305-763-3819' }, students: [{ name: 'Nicholas Llanes', email: null, age: null }] },
  { familyName: 'Cherie-Lloyd Family', parent: { name: 'Dana Cherie', email: 'hellodanacherie@gmail.com', phone: '727-287-7757' }, students: [{ name: 'Alexander Lloyd', email: 'zandertime5729@gmail.com', age: 14 }] },
  { familyName: 'Lucciano Family', parent: { name: 'Christie Lucciano', email: 'christie.lucciano@gmail.com', phone: '234-414-4474' }, students: [{ name: 'Liliana Lucciano', email: null, age: 12 }] },
  { familyName: 'Martinez Family', parent: { name: 'Mary Martinez', email: 'neurodiversemama24@gmail.com', phone: '321-210-2863' }, students: [{ name: 'Jacob Martinez', email: null, age: 11 }, { name: 'Noah Martinez', email: null, age: 9 }] },
  { familyName: 'Alexis-McCall Family', parent: { name: 'Valia Alexis', email: 'valia.alexis@gmail.com', phone: '786-292-0515' }, students: [{ name: 'Dorrel McCall', email: null, age: 8 }] },
  { familyName: 'McDonald Family', parent: { name: 'Jamie McDonald', email: 'jamiechristinee@gmail.com', phone: '727-643-2626' }, students: [{ name: 'Ruby McDonald', email: null, age: 7 }] },
  { familyName: 'Rojas-Medina Family', parent: { name: 'Veronica Rojas', email: 'veronicarojas03@gmail.com', phone: '347-760-6005' }, students: [{ name: 'Joaquín Medina', email: null, age: 13 }, { name: 'Joel Medina', email: 'medinajoel1021@gmail.com', age: 17 }, { name: 'Nicolás Medina', email: null, age: 9 }] },
  { familyName: 'Hamilton-Mullin Family', parent: { name: 'Erin Hamilton-Mullin', email: 'hamilton.mullin@gmail.com', phone: '727-324-3529' }, students: [{ name: 'Sean Mullin', email: null, age: 13 }] },
  { familyName: 'Pares-Munoz Family', parent: { name: 'Angelisse Pares', email: 'angie_pares@hotmail.com', phone: '656-200-1567' }, students: [{ name: 'Harlen Munoz Pares', email: null, age: null }] },
  { familyName: 'Obst Family', parent: { name: 'Debby Obst', email: 'dobst01@gmail.com', phone: '727-742-3043' }, students: [{ name: 'Emily Obst', email: null, age: 13 }] },
  { familyName: 'Pedroza Family', parent: { name: 'Gisele Pedroza', email: 'rubi341@yahoo.com', phone: '321-274-5552' }, students: [{ name: 'Kelvin Pedroza', email: 'seytcraft@gmail.com', age: 15 }] },
  { familyName: 'Phillips Family', parent: { name: 'Danielle Phillips', email: 'Phillipsd81@hotmail.com', phone: '845-537-5105' }, students: [{ name: 'Kayleigh Phillips', email: null, age: 14 }] },
  { familyName: 'Marti-Pierantoni Family', parent: { name: 'Glorimar Marti', email: 'gmart05@hotmail.com', phone: '407-929-3622' }, students: [{ name: 'Jayden Pierantoni', email: 'jmpierantoni@gmail.com', age: 17 }] },
  { familyName: 'Hodges-Potillo Family', parent: { name: 'MJ Hodges', email: 'kriyajoy@gmail.com', phone: '727-313-7988' }, students: [{ name: 'Zai Potillo', email: null, age: 9 }] },
  { familyName: 'Rekstis Family', parent: { name: 'Melly Rekstis', email: 'm3llyk@hotmail.com', phone: '727-488-4871' }, students: [{ name: 'Declan Rekstis', email: null, age: 10 }] },
  { familyName: 'Reynolds Family', parent: { name: 'Larissa Reynolds', email: 'larissa@neversettle.org', phone: '317-931-8070' }, students: [{ name: 'Cecilia Reynolds', email: null, age: 8 }, { name: 'Malakai Reynolds', email: null, age: 10 }] },
  { familyName: 'Rivera Family (Ashley)', parent: { name: 'Ashley Rivera', email: 'riverafamily7512@gmail.com', phone: '954-348-4760' }, students: [{ name: 'Roman Rivera', email: null, age: 9 }] },
  { familyName: 'Koel-Riveria Family', parent: { name: 'Crystal Koel', email: 'koel.chick@gmail.com', phone: '206-251-8182' }, students: [{ name: 'Emilia Riveria', email: null, age: 11 }] },
  { familyName: 'Santiago Family', parent: { name: 'Rebekah Santiago', email: 'cottonswab44@gmail.com', phone: '727-543-0346' }, students: [{ name: 'Cameron Santiago', email: null, age: 11 }] },
  { familyName: 'Shurtleff Family', parent: { name: 'Stephanie Shurtleff', email: 'topie191986@gmail.com', phone: '727-520-3114' }, students: [{ name: 'Zayla Shurtleff', email: null, age: 14 }] },
  { familyName: 'Capobianco-Silva Family', parent: { name: 'Stefanie Capobianco', email: 'stefcapobianco@yahoo.com', phone: '727-641-3050' }, students: [{ name: 'Tegan Silva', email: null, age: 10 }] },
  { familyName: 'Smolinski Family', parent: { name: 'Magan Smolinski', email: 'Nutmegm84@aol.com', phone: '727-741-4003' }, students: [{ name: 'Avery Smolinski', email: null, age: null }] },
  { familyName: 'Solanki Family', parent: { name: 'Maria Solanki', email: 'viviennethevegan@gmail.com', phone: '312-292-6484' }, students: [{ name: 'Vivienne Solanki', email: null, age: 12 }] },
  { familyName: 'Negron-Solis Family', parent: { name: 'Jessica Negron-Solis', email: 'jsolis0604@gmail.com', phone: '727-385-2781' }, students: [{ name: 'Jackson Solis', email: null, age: 8 }, { name: 'Oliver Solis', email: null, age: 6 }] },
  { familyName: 'Szabla Family', parent: { name: 'Sara Szabla', email: 'sarahorning@hotmail.com', phone: '813-679-7866' }, students: [{ name: 'Jack Szabla', email: null, age: 16 }, { name: 'Reyne Szabla', email: 'reyneszabla176@gmail.com', age: 17 }] },
  { familyName: 'Tchentsov Family', parent: { name: 'Anna Tchentsov', email: 'annatchentsov@gmail.com', phone: '813-500-7014' }, students: [{ name: 'Vera Tchentsov', email: null, age: 7 }] },
  { familyName: 'Terrence Family', parent: { name: 'Jessica Terrence', email: 'jessicaterrence@gmail.com', phone: '407-310-8499' }, students: [{ name: 'Olive Terrence', email: null, age: 15 }] },
  { familyName: 'Valentine Family', parent: { name: "La'Trelle Valentine", email: 'Mzv912@gmail.com', phone: '904-338-3595' }, students: [{ name: 'David Valentine', email: null, age: null }] },
  { familyName: 'Weaver Family', parent: { name: 'Crystal Weaver', email: 'Cweaver@flstrategic.com', phone: '727-422-8946' }, students: [{ name: 'Cameron Weaver', email: null, age: 14 }] },
  { familyName: 'Young Family (Stephanie)', parent: { name: 'Stephanie Young', email: 'gabby198young@gmail.com', phone: '941-356-8376' }, students: [{ name: 'Audrey Young', email: null, age: 14 }, { name: 'Maxwell Young', email: null, age: 12 }] },
  { familyName: 'Young Family (Jacklyn)', parent: { name: 'Jacklyn Young', email: 'jaclyn.young5@gmail.com', phone: '440-567-8861' }, students: [{ name: 'Ethan Young', email: 'ethanryoung8@gmail.com', age: 18 }] },
];

const existingFamilyAdditions = [
  { familyName: 'Campbell Family', students: [{ name: 'Clementine Campbell', email: null, age: 7 }] },
  { familyName: 'Herrick Family', students: [{ name: 'Mackenzie Herrick', email: null, age: 20 }] },
  { familyName: 'Manning Family', students: [{ name: 'Rose Manning', email: null, age: 13 }] },
  { familyName: 'Niel-Spencer Family', students: [{ name: 'Anna Niel', email: null, age: 12 }] },
  { familyName: 'Wedlake Family', students: [{ name: 'Finn Wedlake', email: 'finnaquila@gmail.com', age: null }] },
  { familyName: 'Leary Family', students: [{ name: 'Avery Leary', email: null, age: 12 }] },
];

const main = async () => {
  for (const { familyName, parent, students } of families) {
    const existingFamily = await prisma.family.findFirst({ where: { name: familyName } });
    if (existingFamily) {
      console.error(`Skipping "${familyName}" — a family with this name already exists (${existingFamily.id}).`);
      continue;
    }

    const existingParent = await prisma.user.findUnique({ where: { email: parent.email } });
    if (existingParent) {
      console.error(`Skipping "${familyName}" — a user with email ${parent.email} already exists (${existingParent.id}).`);
      continue;
    }

    console.log(`\nWould create family: ${familyName}`);
    console.log(`  Parent: ${parent.name} <${parent.email}> ${parent.phone}`);
    for (const s of students) {
      console.log(`  Student: ${s.name}${s.email ? ` <${s.email}>` : ' (no email — synthetic import.local address)'}${s.age ? `, age ${s.age}` : ''}`);
    }

    if (!apply) continue;

    const family = await prisma.family.create({ data: { name: familyName } });

    const parentUser = await prisma.user.create({
      data: {
        firebaseUid: placeholderUid('import'),
        email: parent.email,
        fullName: parent.name,
        phone: parent.phone,
        role: 'PARENT',
        status: 'ACTIVE',
      },
    });

    const memberData = [
      { familyId: family.id, userId: parentUser.id, role: 'parent', isInvoiceRecipient: true },
    ];

    for (const s of students) {
      const email = s.email || `student.${slug(s.name)}.${family.id.slice(0, 6)}@import.local`;
      const studentUser = await prisma.user.create({
        data: {
          firebaseUid: placeholderUid('import'),
          email,
          fullName: s.name,
          phone: s.phone ?? undefined,
          role: 'STUDENT',
          status: 'ACTIVE',
          age: s.age ?? undefined,
        },
      });
      memberData.push({ familyId: family.id, userId: studentUser.id, role: 'child', isInvoiceRecipient: false });
      console.log(`  Created student ${studentUser.fullName} (${studentUser.id})`);
    }

    await prisma.familyMember.createMany({ data: memberData });

    console.log(`Created family ${family.name} (${family.id}) with parent ${parentUser.fullName} (${parentUser.id})`);
  }

  for (const { familyName, students } of existingFamilyAdditions) {
    const family = await prisma.family.findFirst({ where: { name: familyName } });
    if (!family) {
      console.error(`Cannot add to "${familyName}" — family not found.`);
      continue;
    }

    console.log(`\nWould add to existing family: ${familyName} (${family.id})`);
    for (const s of students) {
      console.log(`  Student: ${s.name}${s.email ? ` <${s.email}>` : ' (no email — synthetic import.local address)'}`);
    }

    if (!apply) continue;

    for (const s of students) {
      const email = s.email || `student.${slug(s.name)}.${family.id.slice(0, 6)}@import.local`;
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        console.error(`  Skipping ${s.name} — already exists (${existing.id}).`);
        continue;
      }
      const studentUser = await prisma.user.create({
        data: {
          firebaseUid: placeholderUid('import'),
          email,
          fullName: s.name,
          role: 'STUDENT',
          status: 'ACTIVE',
          age: s.age ?? undefined,
        },
      });
      await prisma.familyMember.create({
        data: { familyId: family.id, userId: studentUser.id, role: 'child', isInvoiceRecipient: false },
      });
      console.log(`  Added student ${studentUser.fullName} (${studentUser.id}) to ${familyName}`);
    }
  }

  if (!apply) {
    console.log('\nDry run — re-run with --apply to write.');
  }
};

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
