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
Le patron marque un produit à surveiller (bouton **« ➕ Surveiller un produit »**, en haut à droite). Ensuite, **chaque fois que ce produit est réceptionné ou transféré**, l'application crée une tâche de comptage.

### Compter : « attendu » vs « en stock maintenant »
L'écran montre **deux nombres, clairement étiquetés** : le stock **« attendu »** (figé au moment où la tâche a été créée) et le stock **« en stock maintenant »** (en direct). Comptez ce que vous avez réellement en main.

### ⚠️ Un écart ne peut plus être clos comme « fait »
C'est le changement le plus important. Si votre comptage trouve une **différence**, elle est **conservée pour être résolue** — on ne peut plus la faire disparaître en cliquant « Fait ». « Fait » ne sert qu'à un comptage qui **correspond**.

### Les tâches anciennes : Recompter ou Retirer
Une tâche qui a trop vieilli est marquée **🕗 ancienne**. Son « attendu » date d'avant que le stock ne bouge, donc le compter maintenant comparerait deux moments différents. L'application le **refuse** au lieu d'écraser silencieusement le chiffre, et propose les deux seules sorties honnêtes :
- **Recompter** — reprend le comptage sur le stock actuel
- **Retirer de la liste** — abandonne la tâche sans rien changer au stock

C'est la même chose si le stock a bougé pendant que vous comptiez.

### Les onglets
- **À compter** — les tâches en attente
- **Écarts** — les différences constatées (trace permanente, jamais supprimée)
- **Résolus** — terminés
- **Endommagé** — la pile des marchandises abîmées (voir « Vendre des marchandises endommagées »)`,
      en: `### What is Stock Check for?
To catch miscounts at the moment goods move. It checks stock at receive or transfer time — complementing a full count, not replacing it.

### "Watch a product"
The boss marks a product to watch (the **"➕ Watch a product"** button, top right). After that, **every time that product is received or transferred**, the app creates a counting task.

### Counting: "expected" vs "in stock now"
The screen shows **two numbers, clearly labelled**: the **"expected"** stock (frozen when the task was created) and the **"in stock now"** live number. Count what you actually have in your hands.

### ⚠️ A difference can no longer be closed as done
This is the most important change. If your count finds a **difference**, it is **kept for you to resolve** — it can no longer be made to disappear by pressing "Done". "Done" is only for a count that **matches**.

### Old tasks: Recount or Remove
A task that has aged is marked **🕗 legacy**. Its "expected" figure predates the stock moving, so counting against it now would compare two different moments. The app **refuses** instead of silently overwriting the number, and offers the only two honest ways out:
- **Recount** — start the count again against today's stock
- **Remove from list** — drop the task, changing no stock

The same applies if the stock moved while you were counting.

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
- Modifier la dette · Supprimer un client · Dépense (avec un montant maximum) · Changer le stock à la main
- Transférer des marchandises · Annuler un transfert · Vendre quand c'est fini · Enregistrer la date de vente
- Corriger le fond de caisse · Corriger une dépense · Voir l'activité des autres · Approbation au-dessus d'un montant

### ⚠️ Un employé non configuré ne peut presque RIEN faire
C'est la question la plus fréquente : **« pourquoi mon employé n'arrive pas à faire ça ? »**

Tant que vous n'avez pas ouvert **Journal du Comptable → Permissions** pour cet employé et **enregistré** ses réglages, il n'a **aucune ligne de permissions** — et l'application refuse par sécurité. Il pourra vendre normalement, mais **pas** enregistrer une dépense, faire une remise, vendre à crédit, ni la plupart des actions ci-dessus.

**Configurer un nouvel employé est une étape à faire, pas un réglage facultatif.** Après l'avoir créé, ouvrez ses permissions et enregistrez-les — même si vous ne changez rien.

### Les montants maximum : vide n'est pas 0
- **Vide** = **aucune limite**. C'est ce qu'il faut laisser si vous ne voulez pas de plafond.
- **0** = **tout est refusé**, même une dépense de 1 FCFA.

Ce sont des sens opposés. Si un employé « autorisé » se voit refuser chaque dépense, regardez d'abord son montant maximum : il est probablement à 0 alors qu'on voulait dire « pas de limite ». L'application vous prévient maintenant quand vous enregistrez 0.

### Points importants
- Certaines permissions s'appliquent à **tout le monde, y compris le patron** — notamment le crédit, le transfert et la vente en rupture.
- Les permissions valent pour **toute la boutique** (toutes les succursales), pas par site.
- Toutes les permissions sont vérifiées **sur le serveur**. Impossible de les contourner.`,
      en: `### Where do I set them?
**Accountant Log → Permissions**, staff member by staff member.

### The three settings
- **Allowed** — they can do it on their own
- **Needs approval** — they can do it, but the boss must approve
- **Blocked** — they cannot at all

### What the boss can control
- Sell on credit · Discount (with a maximum %) · Void a sale · Refund
- Adjust debt · Delete customer · Expense (with a maximum amount) · Change stock by hand
- Transfer goods · Cancel a transfer · Sell when finished · Record sold date
- Correct the opening float · Correct an expense · See other staff's activity · Approval above an amount

### ⚠️ An unconfigured staff member can do almost NOTHING
This is the most common question: **"why can't my staff member do this?"**

Until you open **Accountant Log → Permissions** for that person and **save** their settings, they have **no permissions record at all** — and the app refuses, to be safe. They can still sell normally, but they can **not** record an expense, give a discount, sell on credit, or most of the actions above.

**Setting up a new staff member is a step, not an optional refinement.** After you create them, open their permissions and save — even if you change nothing.

### Maximum amounts: blank is not 0
- **Blank** = **no limit**. Leave it blank if you do not want a ceiling.
- **0** = **everything is refused**, even a 1 FCFA expense.

Those are opposite meanings. If someone who is "allowed" has every expense refused, check their maximum amount first — it is probably 0 when "no limit" was meant. The app now warns you when you save a 0.

### Important points
- Some permissions bind **everyone, including the owner** — notably credit, transfer and selling when finished.
- Permissions apply to the **whole shop** (every branch), not per location.
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
  // ── HELD UNTIL CASHIER MODE SHIPS ─────────────────────────────────────────
  // ⚠️ held: true keeps these OUT of the Help list and out of search. The July
  // rule is that every topic maps to a flow that is SHIPPED AND DEVICE-VERIFIED
  // — it is why scrap-out and the stale scan were left out. Cashier mode is not
  // verified end to end yet, so these are written now (while the detail is
  // fresh) and released on the day the feature is.
  //
  // TO RELEASE: delete the `held: true` line from each, and follow
  // scripts/cashier-mode-switch.md — which also covers the `shift` topic, whose
  // drawer formula becomes wrong on the same day.
  {
    id: "cashier-workflow", section: "sales", icon: "💵", held: true,
    title: { fr: "Le circuit caissier", en: "The cashier workflow" },
    body: {
      fr: `### À quoi ça sert ?
À séparer **qui vend** de **qui tient l'argent**. Le vendeur prépare la commande, le caissier encaisse, le magasinier remet la marchandise. Une seule personne ne fait plus les trois.

### Comment ça marche
1. Le vendeur prépare le panier et appuie sur **Envoyer à la caisse**. Le client reçoit un **bon de commande** qui dit clairement que **rien n'est encore payé**.
2. Le ticket apparaît dans **Caissier**. Le caissier encaisse et imprime le reçu.
3. Le ticket passe dans **Retrait**. Le magasinier remet la marchandise.

### Ce qui ne bouge pas tant que ce n'est pas payé
**Créer un ticket ne déplace rien** : pas de stock, pas d'argent, aucun chiffre dans les rapports. Tout se produit au moment de l'encaissement.

### Et si deux personnes appuient en même temps ?
L'application refuse la seconde et **dit pourquoi**, en nommant le ticket. Elle ne prend jamais deux fois le même paiement.

### « En attente » ne concerne pas votre poste
Un ticket non payé n'appartient à **aucun poste de caisse**. L'argent est enregistré dans le poste qui l'a **encaissé** : un ticket créé lundi et payé mardi est « envoyé » lundi et « encaissé » mardi. Ces deux chiffres ne sont pas censés correspondre.`,
      en: `### What is it for?
To separate **who sells** from **who holds the money**. The salesperson prepares the order, the cashier takes payment, the storekeeper hands the goods over. One person no longer does all three.

### How it works
1. The salesperson builds the cart and presses **Send to cashier**. The customer gets an **order slip** stating clearly that **nothing has been paid yet**.
2. The ticket appears in **Cashier**. The cashier takes payment and prints the receipt.
3. The ticket moves to **Pickup**. The storekeeper hands the goods over.

### Nothing moves until it is paid
**Raising a ticket moves nothing** — no stock, no money, no figure in any report. Everything happens at the moment of payment.

### What if two people press at the same time?
The app refuses the second and **says why**, naming the ticket. It never takes the same payment twice.

### "Still waiting" is not about your shift
An unpaid ticket belongs to **no shift**. Money is recorded in the shift that **collected** it: a ticket raised Monday and paid Tuesday is "sent" on Monday and "collected" on Tuesday. Those two figures are not meant to match.`,
    },
  },
  {
    id: "expense-tickets", section: "cashflow", icon: "💸", held: true,
    title: { fr: "Les dépenses via la caisse", en: "Expenses through the till" },
    body: {
      fr: `### Le même circuit, dans l'autre sens
Les ventes font **entrer** l'argent, les dépenses le font **sortir** — et les deux passent par la caisse. Le vendeur ou le magasinier **demande**, le caissier **paie**.

### Comment ça marche
1. N'importe quel employé autorisé enregistre la dépense. Elle part **à la caisse** : rien n'est encore payé.
2. Elle apparaît dans **Paiements**. Le caissier choisit le mode (espèces, MoMo, virement) et paie.
3. Elle compte alors dans les dépenses du jour et dans la caisse.

### Créer une dépense ne sort aucun argent
Tant que le caissier n'a pas payé, la dépense **n'apparaît dans aucun total** et ne touche pas le tiroir. C'est voulu : elle n'est pas encore sortie.

### Pas besoin d'une caisse ouverte pour demander
Demander un paiement ne nécessite **pas** de poste ouvert — un vendeur peut enregistrer le livreur à 7h, avant l'ouverture de la caisse. **Payer**, en revanche, exige une caisse ouverte : c'est là que l'argent sort.

### Annuler
Une dépense non payée peut être **annulée**, avec un **motif obligatoire**. Une annulation ne renverse rien — rien n'a bougé — donc ce motif est la **seule trace** qu'elle a existé. Écrivez-le pour quelqu'un qui lira dans six semaines.`,
      en: `### The same flow, in reverse
Sales bring money **in**, expenses take it **out** — and both go through the till. Any authorised staff member **asks**, the cashier **pays**.

### How it works
1. Whoever needs the money records the expense. It goes **to the till**: nothing is paid yet.
2. It appears in **Payouts**. The cashier picks how it is paid (cash, MoMo, bank) and pays it.
3. Only then does it count in the day's expenses and in the drawer.

### Raising an expense takes no money out
Until the cashier pays it, the expense appears in **no total** and does not touch the drawer. That is deliberate: it has not left yet.

### You do not need an open till to ask
Asking does **not** need an open shift — a salesperson can record the delivery driver at 7am, before the till opens. **Paying** does need one: that is when the money leaves.

### Cancelling
An unpaid expense can be **cancelled**, with a **required reason**. Cancelling reverses nothing — nothing moved — so that reason is the **only record** the expense ever existed. Write it for someone reading in six weeks.`,
    },
  },
  {
    id: "cashier-oversight", section: "reports", icon: "🛡️", held: true,
    title: { fr: "Surveiller la caisse", en: "Watching the till" },
    body: {
      fr: `### À quoi sert cet onglet ?
Le circuit caissier partage une vente entre trois personnes. Cela rend le vol plus difficile, mais pas plus **visible** — cet onglet (Rapports → Caisse) rassemble les morceaux.

### Deux chiffres qui ne doivent PAS correspondre
- **Par caissier** — calculé sur le **paiement**. Correspond au tiroir.
- **Par vendeur** — calculé sur le **ticket**. Ne correspond pas au tiroir, et ce n'est pas une erreur : un ticket créé lundi et payé mardi apparaît des deux côtés, à des jours différents.

### « Auto-encaissé »
La même personne a créé **et** encaissé le ticket. Dans une petite boutique avec une seule personne présente, c'est simplement la réalité de la journée. C'est **signalé, pas accusé** — le circuit ne peut pas l'empêcher, alors il le mesure.

### Les dépenses
Section séparée, jamais mélangée aux encaissements : l'argent qui sort n'est pas de l'argent qui entre. Seules les dépenses **payées** correspondent aux « dépenses espèces » du tiroir. Celles en attente ou annulées n'ont déplacé aucun argent.`,
      en: `### What is this tab for?
The cashier workflow splits one sale across three people. That makes theft harder to do, but no easier to **see** — this tab (Reports → Till) reassembles the pieces.

### Two figures that should NOT match
- **Per cashier** — anchored on the **payment**. Ties to the drawer.
- **Per salesperson** — anchored on the **ticket**. Does not tie to the drawer, and that is not an error: a ticket raised Monday and paid Tuesday appears on both sides, on different days.

### "Self-served"
The same person raised **and** paid the ticket. In a quiet shop with one person on, that is simply what the day looked like. It is **flagged, not accused** — the workflow cannot prevent it, so it measures it.

### Expenses
A separate section, never mixed into the takings: money out is not money in. Only **paid** expenses tie to "cash expenses" in the drawer. Waiting and cancelled ones have moved no money.`,
    },
  },
  {
    id: "stock-value", section: "inventory", icon: "💰",
    title: { fr: "La valeur du stock", en: "Stock value" },
    body: {
      fr: `### Que compte ce chiffre ?
La **valeur du stock en boutique** : ce qui est physiquement présent dans vos sites, en ce moment, au prix d'achat.

Pour chaque article : **quantité × prix d'achat**. Additionné sur tout votre stock.

### « Avant + marchandises reçues = après » — pourquoi ça ne tombe pas toujours juste
C'est le calcul naturel, et il est juste sur le principe. Mais **deux choses font bouger le chiffre sans qu'aucune marchandise ne soit vendue ni reçue.** Si vos comptes ne tombent pas, c'est presque toujours l'une des deux.

### 1. Les marchandises en route
Quand un site expédie un transfert, le stock **sort tout de suite** du site d'origine. Il n'entre au site destinataire **qu'à la confirmation de réception**. Entre les deux, la marchandise est sur la route : elle est bien à vous, mais elle n'est comptée **dans aucun site**.

C'est pour cela que l'écran Inventaire affiche, à côté du total, une ligne **« en route »** avec le nombre de transferts concernés. Le total plus la ligne « en route » = tout ce que vous possédez.

Pour la faire rentrer : le site destinataire confirme la réception.

### 2. Le prix d'achat a changé
Si vous modifiez le **prix d'achat** d'un produit, la valeur de **tout le stock existant** de ce produit change immédiatement — sans qu'un seul article ne bouge.

Exemple : 192 unités en stock, prix d'achat passé de 900 à 850 → la valeur baisse de **9 600** et rien n'a été vendu.

Deux relevés à quelques minutes d'intervalle peuvent donc différer sans aucune vente entre les deux.

### Ce que le chiffre ne compte pas
- Les marchandises **en route** (voir ci-dessus — affichées à part)
- Le **prix de vente** : c'est une valeur au prix d'achat, pas votre chiffre d'affaires potentiel
- Les articles **sans prix d'achat renseigné** comptent pour zéro — renseignez-le pour que le total soit juste

### Qui voit ce chiffre ?
Le **patron** uniquement.`,
      en: `### What does this number count?
The **value of stock on hand**: what is physically in your locations right now, at cost price.

For each item: **quantity × cost price**. Added up across all your stock.

### "Before + goods received = after" — why that does not always land
That is the natural sum, and the thinking is right. But **two things move the figure without anything being sold or received.** If your arithmetic does not come out, it is almost always one of these.

### 1. Goods in transit
When a location dispatches a transfer, the stock **leaves the sending site immediately**. It only arrives at the receiving site **when someone confirms receipt**. In between, the goods are on the road: they are yours, but they are counted at **neither location**.

That is why the Inventory screen shows an **"in transit"** figure beside the total, with the number of transfers. The total plus the in-transit line is everything you own.

To bring it in: the receiving site confirms the delivery.

### 2. The cost price changed
If you edit a product's **cost price**, the value of **all existing stock** of that product changes at once — without a single item moving.

Example: 192 units held, cost price changed from 900 to 850 → the value drops by **9,600** and nothing was sold.

So two readings minutes apart can differ with no sale between them.

### What the number does not include
- Goods **in transit** (see above — shown separately)
- The **selling price**: this is a value at cost, not what your stock could earn
- Items with **no cost price set** count as zero — fill it in so the total is right

### Who sees it?
The **owner** only.`,
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

### ⚠️ Ce qui ne peut PAS attendre la connexion
Vendre fonctionne hors ligne. Certaines actions, non — et elles sont **désactivées** avec une explication plutôt que mises en file :

- **Retour, échange, annulation d'une vente**
- **Encaisser ou remettre un ticket** (mode caissier)
- **Payer une dépense** (mode caissier)

Ce n'est pas une limite technique, c'est une protection. Ces actions dépendent de l'état **actuel** du ticket ou de la vente. Rejouée une heure plus tard, la même demande pourrait rembourser deux fois, ou payer un fournisseur une seconde fois après qu'un collègue l'a déjà fait. Mieux vaut un bouton grisé qui dit pourquoi.

### La file de synchronisation
S'il y a un problème, l'écran « Synchronisation en attente » montre ce qui bloque, avec un bouton **Réessayer**. Si une vente reste bloquée, cliquer sur Réessayer.`,
      en: `### Does the app work without internet?
Yes. You can sell normally with no connection. Sales are kept on the phone.

### What happens when the connection comes back?
Sales sync automatically. **Each sale syncs exactly once** — never duplicated, never lost.

### ⚠️ What canNOT wait for the connection
Selling works offline. Some actions do not — and they are **disabled with an explanation** rather than queued:

- **Return, exchange, void a sale**
- **Take payment or hand over a ticket** (cashier mode)
- **Pay an expense out** (cashier mode)

This is a protection, not a technical limit. These actions depend on the **current** state of the ticket or sale. Replayed an hour later, the same request could refund twice, or pay a supplier a second time after a colleague already did. A greyed-out button that says why is the better outcome.

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
  {
    id: "accountant_log", section: "sales", icon: "🛡️",
    title: { fr: "Journal du comptable et Registre", en: "Accountant Log & Activity Ledger" },
    body: {
      fr: `### À quoi sert cet écran ?
Il vous montre **qui a fait quoi, et quand** dans votre boutique — surtout quand vous n'êtes pas là. Ouvrez le **Registre** pour tout voir, et filtrez par employé, par type d'action, ou par dates (par exemple « juin à juillet »).

### Que veut dire chaque type ?
- **Vente** : un article a été vendu.
- **Annulation** : une vente a été annulée.
- **Remboursement** : de l'argent a été rendu au client.
- **Transfert envoyé / reçu** : des marchandises ont été déplacées entre boutiques — qui a envoyé, qui a reçu.
- **Marchandises reçues** : quelqu'un a enregistré des marchandises arrivées.
- **Marchandises tarifées** : le patron a fixé le prix et mis les marchandises en stock.
- **Dette encaissée** : un client a remboursé une dette.
- **Remise** : un rabais a été donné sur une vente.
- **Stock ajusté** : la quantité en stock a été corrigée à la main.
- **Poste ouvert / fermé** : un caissier a ouvert ou fermé sa caisse.

### Ce que vous décidez, vous le patron
- **Laisser le personnel voir sa propre activité** (dans Paramètres) : si activé, chaque employé peut voir la liste de **ses propres** actions — jamais celles des autres. Désactivé = vous seul voyez le journal.
- **Alertes** : recevez une notification quand une action à vérifier a lieu (annulation, remboursement, dette modifiée…).

> Astuce : tapez un numéro **TRF-…** (transfert) ou **BUF-…** (marchandises) dans la recherche pour ouvrir directement son détail.

**Note :** les changements de **prix** et de **coût** ne sont enregistrés qu'à partir d'aujourd'hui — le passé n'a pas d'historique.`,
      en: `### What is this screen for?
It shows you **who did what, and when** in your shop — especially while you're away. Open the **Ledger** to see everything, and filter by staff member, by type of action, or by dates (for example "June to July").

### What does each type mean?
- **Sale**: an item was sold.
- **Void**: a sale was cancelled.
- **Refund**: money was given back to a customer.
- **Transfer sent / received**: goods moved between shops — who sent, who received.
- **Goods received**: someone logged goods that arrived.
- **Goods priced/released**: the boss set the price and put the goods into stock.
- **Debt collected**: a customer paid back a debt.
- **Discount**: a price cut was given on a sale.
- **Stock adjusted**: the stock quantity was corrected by hand.
- **Shift opened / closed**: a cashier opened or closed their drawer.

### What you, the boss, decide
- **Let staff see their own activity** (in Settings): if on, each staff member can see a list of **their own** actions — never anyone else's. Off = only you see the log.
- **Alerts**: get a notification when something worth checking happens (a void, a refund, a debt change…).

> Tip: type a **TRF-…** (transfer) or **BUF-…** (goods) number in the search box to open its detail directly.

**Note:** **price** and **cost** changes are only recorded from today onward — the past has no history.`,
    },
  },
];

export default HELP_TOPICS;
