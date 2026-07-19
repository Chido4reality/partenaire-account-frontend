// MP-HELP v1 — bundled, offline, static help content (no AI, no backend).
// Chopped from Guide-Mon-Partenaire-FR-EN.md (chat-authored, bilingual). Long-form
// lives HERE (not the t() dict). Each body is markdown-lite: ### sub-heading, "- "
// bullet, "1." numbered, "> " quote, **bold** — rendered by HelpPage's tiny parser.
//
// TOPIC GATE (v1): SHIPPED + device-verified topics ONLY. Deliberately OMITTED
// until Peter tap-tests them: Scrap out, the damaged offline-queue, and the stale
// "Not moving" 60-day scan. `section` mirrors Layout NAV sections for the future
// per-screen "?" deep-link (/help#<section>) — not wired in v1.

export const HELP_TOPICS = [
  {
    id: "login", section: "sales", icon: "🔑",
    title: { fr: "Se connecter", en: "Log in" },
    body: {
      fr: `### Comment se connecter ?
L'utilisateur entre son numéro de téléphone et son code PIN. Chaque membre du personnel a son propre PIN.

Un même identifiant peut être partagé par une boutique entière (par exemple « Boutique Bepanda »). C'est volontaire et normal pour certains commerçants — mais dans ce cas, les ventes ne peuvent pas être attribuées à une personne précise.`,
      en: `### How do I log in?
Enter your phone number and PIN. Each staff member has their own PIN.

One login can be shared by a whole branch (e.g. "Bepanda Shop"). This is intentional and normal for some shops — but in that case, sales cannot be traced to one person.`,
    },
  },
  {
    id: "language", section: "settings", icon: "🌐",
    title: { fr: "Changer la langue", en: "Change the language" },
    body: {
      fr: `### Comment changer la langue ?
Dans le menu latéral, en bas, il y a un bouton « Français / English ». Chaque utilisateur peut choisir sa langue. Cette aide suit automatiquement le choix de langue de l'application.`,
      en: `### How do I change the language?
In the side menu, near the bottom, there is a "Français / English" button. Each user picks their own. This Help follows the app's language choice automatically.`,
    },
  },
  {
    id: "shift", section: "cashflow", icon: "🧾",
    title: { fr: "Ouvrir et fermer un poste (caisse)", en: "Open & close a shift (drawer)" },
    body: {
      fr: `### Faut-il ouvrir un poste avant de vendre ?
Oui. Avant de commencer à vendre, le caissier ouvre son poste et saisit le **fond de caisse** (l'argent déjà présent dans le tiroir au début).

### Comment le tiroir est-il calculé ?
**Tiroir attendu = fond de caisse + espèces encaissées + dettes encaissées en espèces − remboursements en espèces − dépenses**

### Pourquoi « Remboursements en espèces » semble parfois faible ?
Parce que les échanges payés en espèces apparaissent sur une ligne séparée (« Échanges »). Les deux lignes sont bien soustraites du total. Le total est correct — c'est simplement affiché en deux parties.

### Que faire à la fin du poste ?
Le caissier ferme le poste, compte l'argent réel et le saisit. L'application compare avec le montant attendu et affiche l'écart.`,
      en: `### Do I need to open a shift before selling?
Yes. Before selling, the cashier opens a shift and enters the **opening float** (the cash already in the drawer at the start).

### How is the drawer calculated?
**Expected drawer = opening float + cash taken + debts collected in cash − cash refunds − expenses**

### Why does the "Cash refunds" line sometimes look low?
Because cash-paid exchanges appear on their own line ("Exchanges"). Both lines are subtracted from the total. The total is correct — it's just shown in two parts.

### What happens at the end of a shift?
The cashier closes the shift, counts the real cash and enters it. The app compares with the expected amount and shows the difference.`,
    },
  },
  {
    id: "sale", section: "sales", icon: "🛒",
    title: { fr: "Faire une vente", en: "Make a sale" },
    body: {
      fr: `### Comment faire une vente normale ?
1. Ouvrir l'écran de vente
2. Chercher ou scanner le produit
3. Choisir la quantité
4. Ajouter un client (optionnel ; obligatoire pour une vente à crédit)
5. Cliquer sur **Confirmer le paiement**
6. Choisir le mode de paiement
7. Le reçu s'affiche et peut être imprimé ou envoyé par WhatsApp

### Quels modes de paiement existent ?
- **Espèces (cash)**
- **Mobile Money**
- **Crédit** — le client ne paie pas maintenant ; le montant est ajouté à sa dette
- **Paiement partiel** — le client paie une partie ; le reste devient une dette

### Peut-on mettre une vente en attente ?
Oui. Le panier peut être mis en attente (held cart) et repris plus tard.`,
      en: `### How do I make a normal sale?
1. Open the sales screen
2. Search or scan the product
3. Choose the quantity
4. Add a customer (optional; required for a credit sale)
5. Tap **Confirm Payment**
6. Choose the payment method
7. The receipt appears — print it or send it by WhatsApp

### What payment methods are there?
- **Cash**
- **Mobile Money**
- **Credit** — customer pays nothing now; the amount is added to their debt
- **Partial payment** — customer pays part; the rest becomes debt

### Can I hold a sale?
Yes. A cart can be held and resumed later.`,
    },
  },
  {
    id: "tier-pricing", section: "sales", icon: "🏷️",
    title: { fr: "Prix par palier (gros / détail)", en: "Tier pricing (wholesale / retail)" },
    body: {
      fr: `### Qu'est-ce que le prix par palier ?
Un produit peut avoir plusieurs prix selon la quantité (par exemple : prix de détail, prix de gros). L'application applique automatiquement le bon prix.`,
      en: `### What is tier pricing?
A product can have several prices depending on quantity (e.g. retail price, wholesale price). The app applies the right one automatically.`,
    },
  },
  {
    id: "discount", section: "sales", icon: "％",
    title: { fr: "Faire une remise", en: "Give a discount" },
    body: {
      fr: `### Comment faire une remise ?
Le caissier peut appliquer une remise sur une ligne. Mais le patron peut limiter cela : bloquer complètement les remises, ou fixer un pourcentage maximum. Au-delà, une approbation est demandée.`,
      en: `### How do I give a discount?
A cashier can apply a discount to a line. But the boss can limit this: block discounts entirely, or set a maximum percentage. Above that, approval is required.`,
    },
  },
  {
    id: "below-cost", section: "sales", icon: "📉",
    title: { fr: "Vente en dessous du prix de revient", en: "Below-cost sale" },
    body: {
      fr: `### Qu'est-ce qu'une vente en dessous du prix de revient ?
C'est quand on vend un produit moins cher que ce qu'il a coûté — donc à perte. L'application le détecte et demande l'approbation du patron.`,
      en: `### What is a below-cost sale?
Selling a product for less than it cost — at a loss. The app detects this and asks for the boss's approval.`,
    },
  },
  {
    id: "out-of-stock", section: "sales", icon: "🚫",
    title: { fr: "Produit fini (rupture de stock)", en: "Out-of-stock behaviour" },
    body: {
      fr: `### Que se passe-t-il si le produit est fini ?
Par défaut, l'application **bloque** la vente : « Ce produit est fini. Demandez au patron. » Le patron peut changer cela par employé :
- **Bloqué** — ne peut pas vendre un produit fini (réglage par défaut, le plus sûr)
- **Autorisé** — peut vendre même si le stock est à zéro
- **Approbation requise** — peut vendre, mais le patron doit valider à chaque fois

### « Ce produit n'est pas en stock ici »
Le produit n'existe pas dans cette boutique. Le transférer, le retirer du panier, ou changer de boutique.`,
      en: `### What happens when a product is finished?
By default the app **blocks** the sale: "This product is finished. Ask the boss." The boss can change this per staff member:
- **Blocked** — cannot sell a finished product (the default, safest)
- **Allowed** — can sell even at zero stock
- **Needs approval** — can sell, but the boss must approve each time

### "This product is not stocked here"
The product doesn't exist at this branch. Transfer it, remove it from the cart, or switch branch.`,
    },
  },
  {
    id: "approvals", section: "sales", icon: "✅",
    title: { fr: "Les approbations (le point le plus important)", en: "Approvals (the most important part)" },
    body: {
      fr: `### Comment ça marche ?
Le caissier construit sa vente **librement et sans interruption** : prix en dessous du coût, remise, crédit — tout ce qu'il veut. Aucune fenêtre ne l'interrompt pendant qu'il travaille.

C'est **seulement au moment de « Confirmer le paiement »** que l'application vérifie tout d'un coup. S'il y a quelque chose qui nécessite une approbation, **une seule fenêtre** apparaît listant **toutes** les actions ensemble.

### Que peut faire le caissier ?
1. **Entrer le PIN du patron** — si le patron est présent, la vente se termine tout de suite
2. **Envoyer la demande au patron** — elle part dans « Mes demandes » et attend
3. **Annuler**

### Après approbation, les prix changent-ils ?
Non. Le prix, le client, la remise — tout reste exactement comme le caissier l'a saisi.

### Peut-on vendre deux fois la même commande ?
Non. Une commande n'existe qu'à un seul endroit. Une commande = une seule demande = une seule décision du patron.`,
      en: `### How does it work?
The cashier builds the whole sale **freely, with no interruptions**: below-cost price, discount, credit — anything. No popup interrupts them while they work.

**Only when they tap "Confirm Payment"** does the app check everything at once. If anything needs approval, **one single popup** appears listing **all** the actions together.

### What can the cashier do then?
1. **Enter the boss's PIN** — if the boss is there, the sale completes immediately
2. **Send the request to the boss** — it goes to "My Requests" and waits
3. **Cancel**

### After approval, do the prices change?
No. The price, the customer, the discount — everything stays exactly as the cashier set it.

### Can the same order be sold twice?
No. An order exists in only one place. One order = one request = one decision.`,
    },
  },
  {
    id: "add-product", section: "inventory", icon: "➕",
    title: { fr: "Ajouter un produit", en: "Add a product" },
    body: {
      fr: `### Comment ajouter un produit ?
Depuis l'écran **Inventaire**, ouvrir « Ajouter un produit ». Saisir le nom, le prix de vente (et le prix de gros / par palier si besoin), le prix de revient, et le code-barres si le produit en a un. Enregistrer.

Le produit est ensuite disponible à la vente. Le stock se met à jour quand on **réceptionne** la marchandise (voir « Réceptionner des marchandises »).`,
      en: `### How do I add a product?
From the **Inventory** screen, open "Add product". Enter the name, the sell price (and the wholesale / tier price if needed), the cost price, and the barcode if the product has one. Save.

The product is then available to sell. Stock updates when you **receive** goods (see "Receiving goods").`,
    },
  },
  {
    id: "receive-goods", section: "transfers", icon: "📥",
    title: { fr: "Réceptionner des marchandises", en: "Receive goods" },
    body: {
      fr: `### Réceptionner des marchandises
Quand la marchandise arrive, on la **réceptionne** dans une boutique ou un magasin. Le stock augmente.`,
      en: `### Receiving goods
When goods arrive, you **receive** them into a shop or warehouse. Stock goes up.`,
    },
  },
  {
    id: "transfer", section: "transfers", icon: "🔄",
    title: { fr: "Transférer entre boutiques", en: "Transfer between branches" },
    body: {
      fr: `### Comment transférer ?
1. La boutique/magasin d'origine **envoie** (dispatch)
2. La boutique de destination **réceptionne** (confirm)

Le stock est déduit d'un côté et ajouté de l'autre. Les deux côtés sont toujours équilibrés. **On ne peut jamais réceptionner plus que ce qui a été envoyé.**

### Qui peut transférer ?
Par défaut : le patron, le gérant et le magasinier. **Le caissier peut réceptionner** (pour que la marchandise ne reste jamais bloquée quand le patron est absent). Le patron peut accorder à un caissier le droit de transférer — mais seulement depuis sa propre boutique.

### Ajuster le stock à la main
Si le stock physique ne correspond pas, on peut le corriger. C'est une action sensible : le patron peut la bloquer pour un employé. La bloquer n'empêche pas le magasinier de réceptionner et transférer.`,
      en: `### How do I transfer?
1. The source shop/warehouse **dispatches**
2. The destination shop **confirms receipt**

Stock is deducted from one side and added to the other. Both sides always balance. **You can never receive more than was sent.**

### Who can transfer?
By default: owner, manager, warehouse. **A cashier can receive** — so goods are never stuck when the boss is away. The boss can grant a cashier the right to transfer — but only from their own shop.

### Adjusting stock by hand
If physical stock doesn't match, it can be corrected. This is a sensitive action: the boss can block it for a staff member. Blocking it does NOT stop a warehouse keeper from receiving and transferring.`,
    },
  },
  {
    id: "customers-debt", section: "customers", icon: "👥",
    title: { fr: "Clients et dettes", en: "Customers & debt" },
    body: {
      fr: `### Comment fonctionne la dette ?
Quand un client achète à crédit, sa dette augmente automatiquement. Quand il paie, elle diminue. Quand il retourne un article, elle diminue aussi. **La dette est calculée automatiquement** — personne ne peut la modifier à la main sans laisser une trace.

### Comment encaisser une dette ?
Depuis la fiche du client : « Encaisser ». Le système ne permet jamais d'encaisser plus que ce qui est dû, et la dette ne peut pas devenir négative.

### Voir les clients par boutique
L'écran Clients permet de filtrer par emplacement pour voir les dettes de chaque boutique séparément.`,
      en: `### How does debt work?
When a customer buys on credit, their debt goes up automatically. When they pay, it goes down. When they return an item, it goes down too. **Debt is calculated automatically** — nobody can change it by hand without leaving a trace.

### How do I collect a debt?
From the customer's record: "Collect". The system never allows collecting more than what is owed, and debt can never go negative.

### See customers by branch
The Customers screen can filter by location to see each branch's debt separately.`,
    },
  },
  {
    id: "void-return-exchange", section: "sales", icon: "↩",
    title: { fr: "Annuler, retourner, échanger", en: "Void, return, exchange" },
    body: {
      fr: `### Annuler une vente (Void)
Pour une erreur. Annule **toute** la vente : l'argent sort de la caisse, la dette est rétablie si c'était un crédit, et le stock revient. La vente sort des totaux mais reste visible pour le patron. Une vente annulée ne peut plus être annulée, encaissée ni remboursée une deuxième fois.

### Retour + Remboursement
Le client rapporte un produit et récupère son argent (totalement ou partiellement).

### Échange
Le client échange un produit contre un autre.

### Le patron voit-il les annulations ?
Oui. Il y a un panneau « Annulations » dans Opérations et une tuile sur le tableau de bord : combien, quelle valeur, par qui, quand. Un caissier ne peut pas le voir.`,
      en: `### Void a sale
For a mistake. Reverses **the whole** sale: cash leaves the drawer, debt is restored if it was credit, stock comes back. The sale leaves the totals but stays visible to the boss. A voided sale cannot be voided, collected or refunded again.

### Return + Refund
The customer brings a product back and gets their money (fully or partly).

### Exchange
The customer swaps one product for another.

### Does the boss see voids?
Yes. There's a "Voids" panel in Operations and a dashboard tile: how many, what value, by whom, when. A cashier cannot see it.`,
    },
  },
  {
    id: "stock-check", section: "stock_check", icon: "🔍",
    title: { fr: "Stock Check (vérification de stock)", en: "Stock Check" },
    body: {
      fr: `### À quoi sert Stock Check ?
À attraper les erreurs de comptage au moment où la marchandise bouge. On vérifie le stock à la réception ou au transfert — en complément d'un comptage complet, pas à sa place.

### « Surveiller un produit »
Le patron marque un produit à surveiller (bouton **« Surveiller un produit »**, en haut à droite). Ensuite, **chaque fois que ce produit est réceptionné ou transféré**, l'application crée automatiquement une tâche de comptage en attente. Quelqu'un doit alors le compter physiquement. Utile pour les produits qui bougent lentement, ou ceux dont on veut être sûr.

### Compter : « attendu » vs « en stock maintenant »
Quand on compte, l'écran montre **deux nombres, clairement étiquetés** : le stock **« attendu »** (figé au moment où la tâche a été créée) et le stock **« en ce moment »** (en direct). C'est volontaire : entre la création de la tâche et le comptage, une vente a pu changer le stock réel. Les deux nombres sont affichés honnêtement pour qu'on sache exactement ce qu'on compare, puis on saisit la quantité réellement comptée.

### Les onglets
- **À compter** — les tâches en attente
- **Écarts (Mismatches)** — les différences constatées (trace permanente, jamais supprimée)
- **Résolus** — terminés
- **Endommagés** — la pile des marchandises abîmées (voir « Vendre des marchandises endommagées »)`,
      en: `### What is Stock Check for?
To catch miscounts at the moment goods move. It checks stock at receive or transfer time — complementing a full count, not replacing it.

### "Watch a product"
The boss marks a product to watch (the **"Watch a product"** button, top right). After that, **every time that product is received or transferred**, the app automatically creates a pending count task. Someone must physically count it. Useful for slow-moving products, or anything you want to be sure about.

### Counting: "expected" vs "in stock now"
When you count, the screen shows **two numbers, clearly labelled**: the **"expected"** stock (frozen when the task was created) and the **"in stock now"** live number. This is deliberate — between the task being created and the count, a sale may have changed the real stock. Both are shown honestly so you know exactly what you're comparing, then you enter the quantity you actually counted.

### The tabs
- **To count** — pending tasks
- **Mismatches** — differences found (permanent record, never deleted)
- **Resolved** — done
- **Damaged** — the damaged-goods pile (see "Sell damaged goods")`,
    },
  },
  {
    id: "damaged-goods", section: "stock_check", icon: "🛠️",
    title: { fr: "Vendre des marchandises endommagées", en: "Sell damaged goods" },
    body: {
      fr: `### Comment un produit entre dans la pile « endommagés » ?
1. **Automatiquement** — lors d'un transfert, si on reçoit moins que ce qui a été envoyé et que l'écart est marqué endommagé
2. **Manuellement** — le patron ou le gérant utilise **« Marquer comme endommagé »** : produit, emplacement, quantité, et une note (par ex. « dégât des eaux »). Le stock vendable diminue ; la quantité passe dans la pile endommagée.

### Comment revendre une marchandise endommagée ?
1. Ouvrir **Stock Check → onglet Endommagés**
2. Filtrer par date si besoin
3. Cliquer sur l'article
4. Choisir la quantité à vendre (le reste demeure dans la pile)
5. L'article part au panier **au prix normal, avec le prix par palier**
6. Appliquer une remise si on veut
7. Terminer la vente normalement

**Le reçu indique clairement « MARCHANDISE ENDOMMAGÉE ».** La vente fonctionne depuis n'importe quelle caisse. Ces ventes comptent comme une vraie recette mais sont **suivies séparément** pour ne pas fausser la marge.`,
      en: `### How does a product get into the damaged pile?
1. **Automatically** — on a transfer, if less is received than was sent and the shortfall is marked damaged
2. **Manually** — the owner or manager uses **"Mark as damaged"**: product, location, quantity, and a note (e.g. "water damage"). Sellable stock goes down; the quantity moves into the damaged pile.

### How do I resell damaged goods?
1. Open **Stock Check → Damaged tab**
2. Filter by date if needed
3. Tap the item
4. Choose the quantity to sell (the rest stays in the pile)
5. It goes to the cart **at the normal price, with tier pricing**
6. Apply a discount if you want
7. Complete the sale normally

**The receipt clearly says "DAMAGED GOODS".** The sale works from any till. These sales count as real revenue but are **tracked separately** so they don't distort margin.`,
    },
  },
  {
    id: "accountant-log", section: "reports", icon: "📒",
    title: { fr: "Le Journal du Comptable", en: "The Accountant Log" },
    body: {
      fr: `### À quoi ça sert ?
C'est l'outil de surveillance du patron. Il permet de **voir tout ce que fait le personnel**, en langage simple, avec la date et l'heure. **Réservé au patron et à l'offre Pro Plus.**

### Que montre-t-il ?
Chaque action sensible : annulation, retour, remboursement, modification de dette ou de client, suppression de client, ajustement de stock à la main, crédit accordé, etc. Deux vues : **Tout** et **À vérifier** (risque élevé uniquement).

### Est-ce que toutes les ventes y apparaissent ?
Non. C'est un **détecteur d'exceptions et de risques**, pas un journal de toutes les ventes. Sur une journée calme, il peut afficher peu de choses. Pour voir toutes les ventes, utiliser les **Rapports** ou les **Filtres**.

### Peut-on l'effacer ?
Non. Le journal est protégé : impossible de le modifier ou de le supprimer. C'est ce qui permet de l'utiliser comme preuve.`,
      en: `### What is it for?
It's the boss's oversight tool. It lets the boss **see everything staff do**, in plain language, with date and time. **Owner only, and Pro Plus only.**

### What does it show?
Every sensitive action: void, return, refund, debt or customer edit, customer deletion, manual stock adjustment, credit extended, and so on. Two views: **Everything** and **Things to check** (high-risk only).

### Does every sale appear there?
No. It's an **exceptions-and-risk monitor**, not a full sales journal. On a quiet day it may show little. To see all sales, use **Reports** or **Filters**.

### Can it be erased?
No. The log is protected: it cannot be edited or deleted. That's what makes it usable as evidence.`,
    },
  },
  {
    id: "permissions", section: "reports", icon: "🔐",
    title: { fr: "Les permissions", en: "Permissions" },
    body: {
      fr: `### Où les régler ?
**Journal du Comptable → Permissions**, employé par employé.

### Les trois réglages
- **Autorisé** — l'employé peut le faire seul
- **Approbation requise** — l'employé peut le faire, mais le patron doit valider
- **Bloqué** — l'employé ne peut pas du tout

### Ce que le patron peut contrôler
- Vendre à crédit · Remise (avec un % maximum) · Annuler une vente · Remboursement
- Modifier la dette · Supprimer un client · Dépense · Changer le stock à la main
- Transférer des marchandises · Vendre quand c'est fini · Enregistrer la date de vente
- Voir l'activité des autres · Approbation au-dessus d'un montant

### Points importants
- Par défaut, un employé sans réglage est **autorisé** pour la plupart des actions — sauf **« Vendre quand c'est fini »** et **« Enregistrer la date de vente »**, **bloqués par défaut**.
- Certaines permissions s'appliquent à **tout le monde, y compris le patron** — notamment le crédit, le transfert et la vente en rupture.
- Toutes les permissions sont vérifiées **sur le serveur**. Impossible de les contourner.`,
      en: `### Where do I set them?
**Accountant Log → Permissions**, staff member by staff member.

### The three settings
- **Allowed** — they can do it on their own
- **Needs approval** — they can do it, but the boss must approve
- **Blocked** — they cannot at all

### What the boss can control
- Sell on credit · Discount (with an optional maximum %) · Void a sale · Refund
- Adjust debt · Delete customer · Expense · Change stock by hand
- Transfer goods · Sell when finished · Record sold date
- See other staff's activity · Approval above an amount

### Important points
- By default, a staff member with no setting is **allowed** for most actions — except **"Sell when finished"** and **"Record sold date"**, which are **blocked by default**.
- Some permissions bind **everyone, including the owner** — notably credit, transfer and selling when finished.
- All permissions are enforced **on the server**. They cannot be bypassed.`,
    },
  },
  {
    id: "filters", section: "reports", icon: "🔎",
    title: { fr: "Les Filtres — « Quoi, Qui, Quand »", en: "Filters — \"What, Who, When\"" },
    body: {
      fr: `### À quoi ça sert ?
À répondre à n'importe quelle question sur l'activité de la boutique, sans changer d'écran. On empile des conditions ; chaque clic **réduit** le résultat.

**Dimensions** (elles filtrent) : Date · Emplacement · Personnel · Client · Produit
**Faits** (ce qu'on regarde) : Ventes · Mouvements de stock · Paiements

### La fiche récapitulative d'un employé
Sélectionner **un employé sans choisir de fait** donne son tableau complet : ventes, chiffre d'affaires, stock entré/sorti, clients servis, retours, espèces encaissées, crédit accordé.

### Qui a vendu le plus ?
Ventes + regrouper par personnel + classer par total. **Conseil :** récompensez la **marge**, pas le chiffre d'affaires.

### Qui peut voir quoi ?
Par défaut, un caissier ne voit que sa propre activité. Le patron peut changer cela par employé : Bloqué / Seulement soi / Tout le personnel.`,
      en: `### What is it for?
To answer any question about shop activity without leaving the screen. You stack conditions; each click **narrows** the result.

**Dimensions** (they filter): Date · Location · Staff · Customer · Product
**Facts** (what you're looking at): Sales · Stock movements · Payments

### A staff member's rollup card
Select **a staff member without choosing a fact** and you get their full card: sales, revenue, stock in/out, customers served, returns, cash received, credit given.

### Who sold the most?
Sales + group by staff + rank by total. **Advice:** reward **margin**, not revenue.

### Who can see what?
By default, a cashier only sees their own activity. The boss can change this per staff member: Blocked / Own only / All staff.`,
    },
  },
  {
    id: "sold-date-note", section: "sales", icon: "📝",
    title: { fr: "La note « Date de vente »", en: "The \"Sold date\" note" },
    body: {
      fr: `### À quoi ça sert ?
Parfois une vente n'a pas pu être enregistrée le jour même. On l'enregistre le lendemain, mais on veut que la **date réelle** apparaisse dans le dossier.

### Comment ça marche ?
Dans le panier, un champ optionnel **« Date de vente »**. Si on le remplit, le reçu affiche une NOTE :
> NOTE — Date de vente : 12/07/2026 (saisi par Kusi)

**Le reçu garde toujours la vraie date d'impression.** La note s'ajoute en plus.

### Est-ce que ça change les comptes ?
Non. Aucun calcul. C'est **uniquement une note**. Les rapports comptent la vente à sa vraie date d'enregistrement.

### Qui peut l'utiliser ?
Personne par défaut. Le patron doit l'autoriser employé par employé. Le système enregistre qui a saisi la note et quand.`,
      en: `### What is it for?
Sometimes a sale couldn't be recorded on the day it happened. You record it the next day, but you want the **real sale date** to show in the record.

### How does it work?
In the cart, an optional **"Sold date"** field. If you fill it in, the receipt shows a NOTE:
> NOTE — Sold Date: 12/07/2026 (recorded by Kusi)

**The receipt always keeps the real printed date.** The note is added on top.

### Does it change the accounts?
No. No calculation at all. It is **only a note**. Reports still count the sale on its real recorded date.

### Who can use it?
Nobody by default. The boss must allow it per staff member. The system records who entered the note and when.`,
    },
  },
  {
    id: "reports", section: "reports", icon: "📋",
    title: { fr: "Les Rapports", en: "Reports" },
    body: {
      fr: `### Quels rapports existent ?
- **Résumé quotidien** — ventes, encaissements, coût, bénéfice, marge, dépenses, dettes encaissées
- **Détail des ventes** — chaque vente, cliquable pour voir les articles
- **Ventes du jour** — les ventes par jour
- **Grand livre du jour** — le détail des mouvements d'argent
- **Meilleurs produits** — les produits qui se vendent le plus
- **Rapport de dettes** — qui doit combien
- **Retours** — les retours effectués

**Export CSV** disponible.

**À savoir :** les ventes annulées sont exclues des totaux. Les marchandises endommagées sont comptées comme recette mais suivies séparément pour ne pas fausser la marge.`,
      en: `### What reports are there?
- **Daily Summary** — sales, cash collected, cost, profit, margin, expenses, debts collected
- **Sales Detail** — every sale, tap to see the items
- **Daily Sales** — sales by day
- **Daily Ledger** — detail of money movements
- **Top Products** — best-selling products
- **Debt Report** — who owes what
- **Returns** — returns made

**CSV export** available.

**Good to know:** voided sales are excluded from totals. Damaged goods count as revenue but are tracked separately so they don't distort margin.`,
    },
  },
  {
    id: "offline", section: "sales", icon: "📶",
    title: { fr: "Le mode hors ligne", en: "Offline mode" },
    body: {
      fr: `### L'application marche-t-elle sans internet ?
Oui. On peut vendre normalement sans connexion. Les ventes sont gardées dans le téléphone.

### Quand la connexion revient ?
Les ventes se synchronisent automatiquement. **Chaque vente ne part qu'une seule fois** — jamais de doublon, jamais de perte.

### La file de synchronisation
S'il y a un problème, l'écran « Synchronisation en attente » montre ce qui bloque, avec un bouton **Réessayer**. Si une vente reste bloquée, cliquer sur Réessayer.`,
      en: `### Does the app work without internet?
Yes. You can sell normally with no connection. Sales are kept on the phone.

### What happens when the connection comes back?
Sales sync automatically. **Each sale syncs exactly once** — never duplicated, never lost.

### The sync queue
If something goes wrong, the "Pending sync" screen shows what's stuck, with a **Retry** button. If a sale is stuck, just tap Retry.`,
    },
  },
  {
    id: "pro-plus", section: "settings", icon: "⭐",
    title: { fr: "Pro Plus", en: "Pro Plus" },
    body: {
      fr: `### Qu'est-ce que Pro Plus débloque ?
- Le **Journal du Comptable** (surveillance du personnel)
- Les **Permissions** (contrôle de ce que chacun peut faire)
- Les rapports approfondis et l'export
- La gestion multi-boutiques complète

C'est la différence entre tenir une boutique et **posséder une entreprise qui tourne même quand on n'est pas là**.`,
      en: `### What does Pro Plus unlock?
- The **Accountant Log** (staff oversight)
- **Permissions** (control what each person can do)
- Deep reports and export
- Full multi-branch management

It's the difference between running a shop and **owning a business that runs even when you're not there**.`,
    },
  },
];

export default HELP_TOPICS;
