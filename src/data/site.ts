// Datos de contacto centralizados: cambiar acá impacta en todo el sitio.
export const site = {
  name: 'KANSO Studio',
  description:
    'Cerámica hecha 100% a mano para espacios y momentos extraordinarios. Vajilla para gastronomía, diseño de producto, cerámica personalizada y talleres privados en Buenos Aires y Málaga.',
  email: 'hola@kanso.ar',
  instagram: 'https://www.instagram.com/kanso.ar/',
  tienda: 'https://kanso2.mitiendanube.com/',
  whatsappAR: 'https://wa.me/5491154681888',
  whatsappES: 'https://wa.me/34681816030',
  telAR: '+54 9 11 5468 1888',
  telES: '+34 681 816 030',
};

export const nav = [
  { label: 'Inicio', href: '/' },
  { label: 'Servicios', href: '/servicios' },
  { label: 'Bio', href: '/bio' },
  { label: 'Eventos privados', href: '/eventosprivados' },
  { label: 'Contacto', href: site.whatsappAR, external: true },
  { label: 'Tienda', href: site.tienda, external: true },
];
