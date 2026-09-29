export function parseArchitectureProfile(value) {
    const profile = value ?? 'simple';
    if (profile !== 'simple' && profile !== 'advanced')
        throw new Error('Profil invalide. Valeurs acceptées : simple, advanced.');
    return profile;
}
export const profileCosts = {
    simple: 'Modules Nest directs : moins de fichiers, adapté aux CRUD et services simples.',
    advanced: 'Ports/adaptateurs : frontières explicites, coût de maintenance plus élevé, adapté aux domaines complexes.',
};
