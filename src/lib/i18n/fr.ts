import type { Dictionary } from './types';

/**
 * French. Polite "vous", typographic apostrophes, and the plain register a
 * colleague would use rather than the one a contract would.
 */
export const fr: Dictionary = {
  shell: {
    language: 'Langue',
    signOut: 'Se déconnecter',
    allChanges: 'Toutes les modifications',
    siteLinkTitle: 'Le site que cet éditeur modifie',
    mainNav: 'Principal',
  },
  home: {
    editing: 'Modification de',
    title: 'Que souhaitez-vous changer ?',
    lede: 'Décrivez-le comme vous le feriez à un collègue. Vous aurez un aperçu à regarder avant que quoi que ce soit ne soit mis en ligne.',
    yourChanges: 'Vos modifications',
    unreachable:
      'Impossible de joindre l’hébergement de votre site pour le moment. Vos modifications sont en sécurité ; réessayez dans un instant.',
    nothingYet: 'Rien pour l’instant. Décrivez une modification ci-dessus et elle apparaîtra ici.',
    updatedJustNow: 'Mis à jour à l’instant',
    updatedMinutes: 'Mis à jour il y a {n} min',
    updatedHour: 'Mis à jour il y a 1 heure',
    updatedHours: 'Mis à jour il y a {n} heures',
    updatedDay: 'Mis à jour il y a 1 jour',
    updatedDays: 'Mis à jour il y a {n} jours',
    updatedOn: 'Mis à jour le {date}',
  },
  conversation: {
    show: 'Afficher',
    conversationTab: 'Conversation',
    previewTab: 'Aperçu',
    conversationAria: 'Conversation',
  },
  status: {
    open: 'Brouillon',
    published: 'Publié',
    closed: 'Fermé',
  },
  messages: {
    nothingYet: 'Rien ici pour l’instant.',
    describeFirst: 'Décrivez la première modification ci-dessous.',
    previewReady: 'Un aperçu est prêt.',
    madeWith: 'Réalisé avec {model}',
    costOf: 'coût {cost}',
    why: 'Pourquoi cela s’est-il produit ?',
  },
  preview: {
    ariaLabel: 'Aperçu',
    title: 'Aperçu',
    updating: 'Mise à jour…',
    private: 'Privé',
    widthAria: 'Largeur de l’aperçu',
    desktop: 'Ordinateur',
    mobile: 'Mobile',
    reload: 'Recharger',
    reloadTitle: 'Recharger l’aperçu',
    openNewTab: 'Ouvrir dans un nouvel onglet',
    visitWebsite: 'Voir votre site',
    frameTitle: 'Aperçu de votre site',
    onItsWay: 'Votre aperçu arrive',
    keepOpen:
      'Vous pouvez laisser cette page ouverte ou revenir plus tard — vous recevrez un e-mail quand ce sera prêt.',
    noPreview: 'Pas d’aperçu cette fois',
    willAppear: 'Votre aperçu apparaîtra ici',
    describeAndSee: 'Décrivez une modification et vous la verrez avant sa mise en ligne.',
  },
  stages: {
    change: {
      starting: 'Démarrage',
      queued: 'En attente d’un tour libre',
      running: 'Modification en cours',
      gating: 'Vérification que c’est autorisé',
      pushing: 'Enregistrement de votre modification',
      building: 'Construction de votre aperçu',
      succeeded: 'Prêt à regarder',
      blocked: 'Arrêté — non autorisé',
      failed: 'Quelque chose s’est mal passé',
      abandoned: 'Arrêté sans terminer',
    },
    publish: {
      starting: 'Démarrage',
      queued: 'En attente d’un tour libre',
      running: 'Publication',
      gating: 'Vérification que la publication est sûre',
      pushing: 'Publication de votre modification',
      building: 'Construction de votre site',
      succeeded: 'En ligne sur votre site',
      blocked: 'Arrêté — non autorisé',
      failed: 'Quelque chose s’est mal passé',
      abandoned: 'Arrêté sans terminer',
    },
    undo: {
      starting: 'Démarrage',
      queued: 'En attente d’un tour libre',
      running: 'Annulation',
      gating: 'Vérification que l’annulation est sûre',
      pushing: 'Retrait de la modification',
      building: 'Reconstruction de votre site',
      succeeded: 'Revenu comme avant',
      blocked: 'Arrêté — non autorisé',
      failed: 'Quelque chose s’est mal passé',
      abandoned: 'Arrêté sans terminer',
    },
  },
  trailTitles: {
    change: 'Avancement de cette demande',
    publish: 'Avancement de la publication',
    undo: 'Avancement de l’annulation',
  },
  working: {
    lines: {
      change: {
        starting: [
          'On retrousse les manches',
          'On cherche votre site',
          'On met la bouilloire en route',
        ],
        queued: [
          'Quelqu’un d’autre est servi en premier',
          'Votre place dans la file est gardée',
          'Votre tour arrive',
        ],
        running: [
          'On lit votre site de haut en bas',
          'On choisit les mots avec soin',
          'On essaie quelques idées et on garde la meilleure',
          'On ajuste les choses en place',
          'On mesure deux fois',
          'On scrute les détails',
          'On vérifie que ça se lit bien à voix haute',
          'On consulte la charte graphique',
        ],
        gating: ['On vérifie que rien d’interdit n’a été touché', 'On compte les modifications'],
        pushing: ['On range votre modification en lieu sûr'],
        building: [
          'Votre hébergement construit l’aperçu',
          'On réchauffe les pixels',
          'L’aperçu mijote — c’est la partie lente',
          'Presque fini',
        ],
      },
      publish: {
        starting: ['On se prépare à la mise en ligne'],
        gating: ['On s’assure que la voie est libre'],
        pushing: ['On envoie votre modification sur le site en ligne'],
        building: [
          'Votre hébergement reconstruit le site',
          'On peaufine les pages en ligne',
          'Presque fini',
        ],
      },
      undo: {
        starting: ['On cherche le chemin du retour'],
        gating: ['On vérifie qu’on peut revenir en arrière sans risque'],
        pushing: ['On remet tout comme c’était'],
        building: ['On reconstruit le site tel qu’il était', 'Presque fini'],
      },
    },
    usual: {
      change: 'généralement 2–4 minutes',
      publish: 'généralement 1–3 minutes',
      undo: 'généralement 1–3 minutes',
    },
    fallback: 'On y travaille',
    pulse: 'en cours en ce moment',
  },
  publish: {
    aria: 'Publication',
    approve: 'Approuver et publier',
    publishQuestion: 'Publier cette modification sur votre site en ligne ?',
    confirmPublish: 'Oui, publier',
    publishNote: 'L’aperçu vous convient ? Publier met cette modification sur votre site en ligne.',
    undo: 'Annuler cette publication',
    undoQuestion: 'Remettre votre site comme il était avant cette modification ?',
    confirmUndo: 'Oui, annuler',
    undoNote: 'Cette modification est en ligne. Vous pouvez remettre votre site comme il était.',
    undoneNote: 'Cette modification a été publiée puis annulée.',
    finishedNote: 'Cette conversation est terminée.',
    oneMoment: 'Un instant…',
    notYet: 'Pas encore',
  },
  composer: {
    alreadyPublished:
      'Cette conversation est déjà publiée. Commencez-en une nouvelle pour une autre modification.',
    closed: 'Cette conversation est fermée. Commencez-en une nouvelle pour une autre modification.',
    placeholder: 'Décrivez une modification de votre site…',
    followUpPlaceholder: 'Décrivez une autre modification',
    examplePlaceholder:
      'Raccourcir le titre de la page d’accueil et mettre le bouton en bleu foncé',
    describeAria: 'Décrire une modification',
    attachedAria: 'Fichiers joints',
    remove: 'Retirer {name}',
    attachAria: 'Joindre des fichiers',
    attachTitle: 'Joignez des images ou des PDF, jusqu’à {size} chacun',
    attach: 'Joindre',
    enterHint: 'Entrée pour envoyer · Maj+Entrée pour une nouvelle ligne',
    sending: 'Envoi…',
    send: 'Envoyer',
    effort: 'Effort',
    spendAria: 'Combien dépenser pour cette modification',
    showDetails: 'Afficher les détails',
    hideDetails: 'Masquer les détails',
    modelLabel: 'Utilise {model}',
    exampleTask: 'Remplacer un logo',
    exampleAbout: 'environ {cost}',
    exampleFree: 'gratuit',
    exampleUnderCent: 'moins d’un centime',
    exampleUnknown: 'pas d’estimation pour ce modèle',
  },
  tiers: {
    free: {
      name: 'Gratuit',
      cost: 'Sans coût',
      hint: 'Idéal pour de petits changements de texte ou de couleur.',
    },
    low: { name: 'Basique', cost: 'Coût faible', hint: 'Retouches rapides du quotidien.' },
    medium: {
      name: 'Standard',
      cost: 'Coût moyen',
      hint: 'Un bon choix par défaut pour la plupart des modifications.',
    },
    high: {
      name: 'Avancé',
      cost: 'Coût élevé',
      hint: 'Travail plus important sur la mise en page ou plusieurs pages.',
    },
    extra: {
      name: 'Expert',
      cost: 'Coût le plus élevé',
      hint: 'Le travail le plus soigné, pour les modifications délicates.',
    },
  },
  errors: {
    blocked_by_policy: 'Votre développeur a protégé cette partie du site.',
    request_in_flight: 'Une modification est déjà en cours — un instant.',
    too_busy:
      'C’est chargé en ce moment, votre modification n’a donc pas été lancée. Réessayez dans quelques minutes. Rien n’a été publié.',
    agent_timeout:
      'Cela a pris trop de temps. Essayez une modification plus petite ou plus précise.',
    build_failed: 'La modification a cassé la construction du site. Je peux essayer de réparer.',
    site_unreachable: 'Impossible de joindre l’hébergement de votre site pour le moment.',
    cost_ceiling: 'Cette demande dépassait la limite autorisée pour ce site.',
    out_of_date: 'Votre site a changé pendant l’enregistrement. Réessayez dans un instant.',
    nothing_to_change: 'Rien n’avait besoin de changer pour cela.',
    nothing_to_publish: 'Rien n’est prêt à être publié ici.',
    nothing_to_undo: 'Il n’y a rien à annuler ici.',
    site_moved_on:
      'Votre site a changé depuis cette mise en ligne ; annuler maintenant emporterait aussi ces modifications plus récentes.',
    site_conflict:
      'Votre site a changé au même endroit que cette modification. Commencez une nouvelle conversation et redemandez-la.',
    model_quota:
      'Le service d’IA a épuisé son quota du jour pour ce site. Réessayez demain. Rien n’a été publié.',
    model_credit:
      'Le service d’IA de ce site n’a plus de crédit. Votre développeur doit le recharger. Rien n’a été publié.',
    model_unavailable:
      'Le service d’IA ne répond pas pour le moment. Réessayez dans un petit moment. Rien n’a été publié.',
    hosting_limit:
      'L’hébergement de votre site a atteint la limite de son offre ; rien ne peut être construit. Voyez votre développeur.',
    internal_error: 'Quelque chose s’est mal passé de mon côté. Rien n’a été publié.',
  },
  errorHelp: {
    blocked_by_policy:
      'Votre développeur a choisi quelles parties de ce site peuvent être modifiées ici, et cette demande allait au-delà. Demandez-lui d’ouvrir la partie dont vous avez besoin.',
    request_in_flight:
      'Une seule modification est appliquée à la fois, pour que deux d’entre elles ne s’écrasent jamais. La vôtre démarrera dès que la précédente sera terminée.',
    too_busy:
      'Plus de modifications ont été demandées en même temps que ce site ne peut en traiter. Rien n’est perdu — renvoyez la même chose dans quelques minutes.',
    agent_timeout:
      'Chaque modification a une limite de temps, pour qu’une demande bloquée ne tourne pas indéfiniment. Demander une seule chose à la fois suffit en général.',
    build_failed:
      'Votre site est reconstruit après chaque modification, et celle-ci a empêché la reconstruction. Rien n’a atteint le site en ligne, vous pouvez réessayer sans risque.',
    site_unreachable:
      'Le service qui met votre site en ligne ne répond pas. Cela se passe en dehors de votre site et se résout généralement tout seul en quelques minutes.',
    cost_ceiling:
      'Chaque modification a une limite de dépense fixée par votre développeur. Une demande plus petite, ou coupée en deux, restera à l’intérieur.',
    out_of_date:
      'Votre site a changé pendant l’enregistrement, et enregistrer maintenant annulerait ce changement. Redemandez la même chose : elle partira de l’état actuel.',
    nothing_to_change:
      'J’ai regardé votre site et il correspond déjà à ce que vous demandez, il n’y avait donc rien à modifier. Si vous pensiez à un autre endroit, précisez lequel.',
    nothing_to_publish:
      'Seule une modification dont vous avez approuvé l’aperçu peut être mise en ligne. Attendez l’aperçu, regardez-le, puis approuvez-le.',
    nothing_to_undo:
      'L’annulation ne concerne qu’une modification mise en ligne depuis cette conversation. Rien d’ici ne l’a été, il n’y a donc rien à reprendre.',
    site_moved_on:
      'D’autres modifications sont passées en ligne après celle-ci. L’annuler maintenant les retirerait aussi, ce n’est donc pas proposé.',
    site_conflict:
      'Une autre modification a depuis touché la même partie de votre site. Redemandez ce que vous voulez : cela partira de ce qui s’y trouve maintenant.',
    model_quota:
      'Le service de rédaction utilisé par ce site a un quota journalier, et celui d’aujourd’hui est épuisé. Il repart demain, et rien de ce que vous avez envoyé n’est perdu.',
    model_credit:
      'Le compte derrière le service de rédaction n’a plus de crédit. Seul votre développeur peut en ajouter, cela vaut la peine de le prévenir.',
    model_unavailable:
      'Le service de rédaction ne répond pas pour le moment. Votre site n’a rien d’anormal, et le service revient généralement en quelques minutes.',
    hosting_limit:
      'L’offre qui héberge votre site limite le nombre de reconstructions, et cette limite est atteinte. Votre développeur peut l’augmenter.',
    internal_error:
      'Quelque chose a échoué dans l’éditeur et non dans votre demande : votre site n’a pas été touché. Réessayez, et prévenez votre développeur si cela persiste.',
  },
  publishRefusals: {
    not_previewed:
      'Il n’y a encore rien de prêt à publier ici. Attendez l’aperçu, puis approuvez-le.',
    published: 'Cette modification est déjà publiée.',
    undone:
      'Cette modification a été publiée puis annulée. Ouvrez-en une nouvelle pour modifier votre site à nouveau.',
    unavailable: 'Cette conversation est terminée, il n’y a donc rien à publier.',
  },
  undoRefusals: {
    not_previewed: 'Rien de cette conversation n’a été publié, il n’y a donc rien à annuler.',
    ready: 'Cette modification n’a pas encore été publiée, il n’y a donc rien à annuler.',
    undone: 'Cette modification a déjà été annulée.',
    unavailable: 'Rien de cette conversation n’est en ligne, il n’y a donc rien à annuler.',
  },
  attachmentRefusals: {
    too_large: 'Ce fichier est trop volumineux. Chaque fichier doit faire 10 Mo au plus.',
    too_many: 'Vous pouvez joindre jusqu’à 5 fichiers à la fois.',
    total_too_large:
      'Ces fichiers dépassent 25 Mo au total. Essayez avec moins de fichiers ou des fichiers plus petits.',
    unsupported: 'Ce type de fichier ne peut pas être joint. Les images et les PDF fonctionnent.',
    empty: 'Ce fichier est vide.',
    unsafe_svg:
      'Cette image contient du script et ne peut donc pas être jointe. Une image simple fonctionne.',
  },
  interrupted: 'Cette demande a été interrompue avant la fin. Rien n’a été publié.',
  publicationInProgress: 'Votre site est en cours de construction — un instant.',
  bringingUpToDate:
    'Votre site a changé depuis la création de cet aperçu. On met d’abord votre modification à jour.',
  login: {
    headline: 'Dites ce que vous voulez changer.',
    headlineEm: 'Voyez-le avant la mise en ligne.',
    lede: 'Dites à {name} ce qu’il faut changer sur votre site, avec vos mots. Vous obtenez un aperçu privé à regarder, et rien n’atteint votre site en ligne tant que vous n’appuyez pas sur publier.',
    checkEmail: 'Consultez votre boîte mail',
    linkOnItsWay:
      'Si {email} est autorisée à modifier ce site, un lien de connexion est en route. Il fonctionne pendant 15 minutes.',
    useDifferent: 'Utiliser une autre adresse',
    signIn: 'Se connecter',
    noPassword: 'Pas de mot de passe. Un lien dans votre boîte mail vous connecte.',
    yourEmail: 'Votre adresse e-mail',
    emailPlaceholder: 'vous@votreentreprise.fr',
    sending: 'Envoi…',
    emailMe: 'M’envoyer un lien de connexion',
    couldNotReach: 'Impossible de joindre {name} pour le moment. Réessayez dans un instant.',
    demoClient: 'Raccourcir le titre de la page d’accueil et mettre le bouton en bleu foncé.',
    demoAgent:
      'C’est fait. Le titre fait quatre mots et le bouton est bleu marine. Votre aperçu est prêt.',
    codeTitle: 'Saisissez votre code',
    codeHint:
      'Ouvrez votre application d’authentification et saisissez le code à six chiffres de ce site.',
    codeLabel: 'Code à six chiffres',
    codeSubmit: 'Continuer',
    codeChecking: 'Vérification…',
    codeRefused: 'Ce code n’a pas été accepté. Essayez le suivant affiché par votre application.',
    codeExpired: 'Ce lien de connexion a expiré. Demandez-en un nouveau.',
    enrollTitle: 'Configurez votre application d’authentification',
    enrollHint:
      'Scannez ceci avec Google Authenticator, 1Password, Authy ou toute application d’authentification. Vous saisirez son code à six chiffres à chaque connexion.',
    enrollKey: 'Ou saisissez cette clé à la main :',
    enrollDone: 'Terminé. Se connecter',
    enrollExpired: 'Ce lien de configuration a expiré. Demandez-en un nouveau à votre développeur.',
  },
};
