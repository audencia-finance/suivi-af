# Suivi AF

Application web de suivi des missions et projets de l'association : chaque membre met à jour son avancement, les responsables valident, tout le monde voit l'état d'ensemble.

- **Comptes individuels** : un compte par membre, créé sur invitation, avec un rôle (membre, responsable, administrateur).
- **Missions** : titre, type, pôle et sous-pôle, dates, une ou plusieurs personnes assignées.
- **Validation** : à 100 %, la mission part « à valider ». Seul un responsable du périmètre la valide ou la renvoie.
- **Rythme attendu** : linéaire entre le début et l'échéance (50 % à mi-parcours, 100 % à la fin). Chaque mission, membre et pôle est « au-dessus », « dans » ou « en dessous » du rythme.
- **Alertes** : échéance proche, retard sur le rythme, mission sans mise à jour, mission à valider.
- **Agenda** : calendrier des échéances, lien d'abonnement pour Google Agenda, export .ics.
- **Temps réel** : les changements apparaissent chez les autres sans recharger la page.

## Contenu du dossier

| Fichier | Rôle |
|---|---|
| `index.html`, `styles.css`, `app.js` | L'application |
| `logo-af.png` | Logo de l'association (à remplacer par une version haute définition, même nom de fichier) |
| `config.js` | Adresse et clé publique du projet Supabase (à remplir) |
| `vendor/supabase.js` | Bibliothèque Supabase (version figée) |
| `supabase/schema.sql` | Base de données : tables, règles de sécurité, agenda |
| `modele-membres.csv` | Modèle pour importer la liste des membres |

## Mise en ligne

### 1. Base de données (Supabase)

La base est déjà installée dans le projet Supabase **AFC** (région Europe) et `config.js` contient son adresse et sa clé publique. Il reste un réglage à faire à la main :

- Dans le tableau de bord Supabase du projet AFC, **Authentication > Sign In / Providers** : désactivez **Confirm email**.
  Le service d'e-mail intégré de Supabase est limité à 2 e-mails par heure, ce qui bloquerait l'inscription de 30 personnes. La sécurité de l'inscription repose sur le code d'invitation personnel.

Pour réinstaller la base ailleurs : créez un projet, collez `supabase/schema.sql` dans **SQL Editor**, cliquez sur **Run**, puis reportez l'adresse du projet et sa **Publishable key** dans `config.js` (jamais la clé « secret »).

### 2. Hébergement (GitHub Pages)

1. Créez un dépôt GitHub **public** (GitHub Pages est gratuit sur les dépôts publics) et déposez-y le contenu de ce dossier.
2. Dans **Settings > Pages** : source « Deploy from a branch », branche `main`, dossier `/ (root)`.
3. L'adresse du site s'affiche après une minute, sous la forme `https://<compte>.github.io/<depot>/`.
4. Dans Supabase, **Authentication > URL Configuration** : indiquez cette adresse comme **Site URL**.

Le dépôt ne contient aucune donnée de l'association : seulement le code et la clé publique. Les données restent dans Supabase et ne sont lisibles qu'après connexion.

### 3. Premier compte et invitations

1. Ouvrez le site, onglet **Première connexion**. **Le tout premier compte créé devient administrateur** : créez-le tout de suite après la mise en ligne.
2. Onglet **Équipe > Importer une liste** : collez la liste des membres (modèle : `modele-membres.csv`).
3. **Copier tous les messages en attente** : chaque message contient l'adresse du site, l'e-mail et le code personnel du membre. Envoyez à chacun le sien.
4. Chaque membre crée son compte avec son e-mail et son code. Son pôle, son poste et son rôle viennent de la liste.

### 4. Google Agenda

Onglet **Agenda** : copiez le lien d'abonnement, puis dans Google Agenda : « Autres agendas » > + > « À partir de l'URL ». Les échéances se mettent à jour seules, au rythme de Google (souvent quelques heures). Pour un rappel précis, chaque mission propose « Ajouter à Google Agenda ».

## Rôles

| Rôle | Peut |
|---|---|
| Membre | Voir tout. Mettre à jour l'avancement de ses missions, commenter, proposer une mission. |
| Responsable | En plus, dans son pôle (ou son seul sous-pôle s'il en a un) : créer, modifier, assigner, valider, renvoyer, supprimer. Il ne valide pas une mission qui lui est assignée. |
| Administrateur | Tout valider, gérer les comptes, les invitations et les réglages. |

Ces règles sont appliquées par la base de données elle-même : elles ne peuvent pas être contournées depuis le navigateur.

Après les élections, un administrateur change le poste et le rôle de chacun dans **Équipe > Modifier**, sans recréer de compte.

## Réglages (administrateur)

Onglet **Équipe > Réglages** : nom de l'association, liste des pôles, sous-pôles et types de mission, tolérance autour du rythme (10 points par défaut), délais d'alerte.

## Limites connues

- **Alertes** : elles s'affichent dans l'application (onglet Alertes et pastille rouge). Il n'y a pas d'envoi d'e-mail ou de notification.
- **Mot de passe oublié** : le lien de réinitialisation part par e-mail, donc il faut d'abord configurer un service d'envoi (SMTP) dans Supabase. Sans cela, un administrateur du projet Supabase peut supprimer le compte dans **Authentication > Users** ; le membre se réinscrit avec son code, mais ses assignations sont à refaire.
- **Projet gratuit Supabase** : il peut être mis en pause après une période sans activité. Il se réactive depuis le tableau de bord Supabase.
