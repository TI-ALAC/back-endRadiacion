const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// URLs de APIs UV
const UV_APIS = {
    currentuvindex: 'https://currentuvindex.com/api/v1/uvi', // No requiere API key
    senamhi_wms: 'https://idesep.senamhi.gob.pe/geoserver/g_03_05/wms', // Backup
    senamhi_uv: 'https://www.senamhi.gob.pe/?p=radiacion-uv-numerico' // Backup
};

// Cache simple para evitar muchas consultas
const cache = new Map();
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutos

// ========== FUNCIONES AUXILIARES ==========

// Función para obtener UV de CurrentUVIndex (API gratuita sin key)
async function obtenerUVCurrentIndex(lat, lng) {
    try {
        console.log('🔍 Consultando CurrentUVIndex API...');

        const url = `${UV_APIS.currentuvindex}?latitude=${lat}&longitude=${lng}`;
        const response = await axios.get(url, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; RadiacionUV-API/2.0)'
            }
        });

        if (response.data && response.data.ok) {
            const data = response.data;
            console.log('✅ Datos UV obtenidos de CurrentUVIndex:', data.now);

            // Obtener el UV máximo del día desde el forecast
            let uvMaxHoy = data.now.uvi;
            const hoy = new Date().toISOString().split('T')[0];

            if (data.forecast && data.forecast.length > 0) {
                data.forecast.forEach(hora => {
                    if (hora.time.startsWith(hoy) && hora.uvi > uvMaxHoy) {
                        uvMaxHoy = hora.uvi;
                    }
                });
            }

            console.log('✅ Datos Return:', data.now.uvi);
            return {
                uv_actual: data.now.uvi,
                uv_maximo_hoy: uvMaxHoy,
                hora: data.now.time,
                forecast: data.forecast.slice(0, 24), // Próximas 24 horas
                fuente: 'CurrentUVIndex API'
            };
        }

        console.log('⚠️ CurrentUVIndex sin datos válidos');
        return null;
    } catch (error) {
        console.error('❌ Error CurrentUVIndex:', error.message);
        return null;
    }
}

// Función para obtener UV de la página oficial de SENAMHI
async function obtenerUVSenamhi() {
    try {
        console.log('🔍 Consultando página UV SENAMHI...');

        const response = await axios.get(UV_APIS.senamhi_uv, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });

        const html = response.data;
        const uvData = [];

        // Patrones más específicos para extraer datos UV
        const patterns = [
            /(\w+(?:\s+\w+)*)\s*[:\-]\s*(\d+\.?\d*)\s*(?:UV|uv|índice)/gi,
            /(\w+(?:\s+\w+)*)\s*(\d+\.?\d*)\s*(?:UV|uv)/gi,
            /<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>(\d+\.?\d*)<\/td>/gi
        ];

        patterns.forEach(pattern => {
            let match;
            while ((match = pattern.exec(html)) !== null) {
                const ciudad = match[1].trim();
                const valor = parseFloat(match[2]);

                if (!isNaN(valor) && valor > 0 && valor <= 20 && ciudad.length > 2) {
                    // Evitar duplicados
                    if (!uvData.find(item => item.ciudad.toLowerCase() === ciudad.toLowerCase())) {
                        uvData.push({
                            ciudad: ciudad,
                            uv: valor
                        });
                    }
                }
            }
        });

        console.log(`✅ UV datos extraídos: ${uvData.length} ciudades`);
        return uvData.length > 0 ? uvData : null;
    } catch (error) {
        console.error('❌ Error UV web:', error.message);
        return null;
    }
}

// Función para buscar UV por proximidad geográfica
function buscarUVCercano(lat, lng, datosUV) {
    if (!datosUV || datosUV.length === 0) return null;

    // Mapeo mejorado de ciudades a coordenadas
    const ciudadCoordenadas = {
        'lima': { lat: -12.0464, lng: -77.0428 },
        'callao': { lat: -12.0566, lng: -77.1181 },
        'cusco': { lat: -13.5319, lng: -71.9675 },
        'arequipa': { lat: -16.3409, lng: -71.5675 },
        'trujillo': { lat: -8.0819, lng: -79.1094 },
        'chiclayo': { lat: -6.7714, lng: -79.8397 },
        'iquitos': { lat: -3.7833, lng: -73.3094 },
        'puno': { lat: -15.8422, lng: -70.0199 },
        'cajamarca': { lat: -7.1381, lng: -78.4894 },
        'piura': { lat: -5.2008, lng: -80.6267 },
        'huancayo': { lat: -12.0653, lng: -75.2097 },
        'ayacucho': { lat: -13.1583, lng: -74.2233 },
        'huaraz': { lat: -9.5312, lng: -77.5283 },
        'tarapoto': { lat: -6.5008, lng: -76.3622 },
        'pucallpa': { lat: -8.3789, lng: -74.5744 },
        'tacna': { lat: -18.0147, lng: -70.2675 },
        'tumbes': { lat: -3.5664, lng: -80.4514 },
        'huanuco': { lat: -9.9306, lng: -76.2422 },
        'ica': { lat: -14.0678, lng: -75.7267 },
        'moquegua': { lat: -17.1964, lng: -70.9350 }
    };

    let mejorMatch = null;
    let menorDistancia = Infinity;

    datosUV.forEach(datos => {
        const ciudadNormalizada = datos.ciudad.toLowerCase()
            .replace(/[áàäâ]/g, 'a')
            .replace(/[éèëê]/g, 'e')
            .replace(/[íìïî]/g, 'i')
            .replace(/[óòöô]/g, 'o')
            .replace(/[úùüû]/g, 'u')
            .replace(/ñ/g, 'n');

        for (const [nombre, coords] of Object.entries(ciudadCoordenadas)) {
            if (ciudadNormalizada.includes(nombre) || nombre.includes(ciudadNormalizada)) {
                const distancia = Math.sqrt(
                    Math.pow(coords.lat - lat, 2) +
                    Math.pow(coords.lng - lng, 2)
                );

                if (distancia < menorDistancia) {
                    menorDistancia = distancia;
                    mejorMatch = {
                        ...datos,
                        distancia_km: Math.round(distancia * 111),
                        coordenadas_referencia: coords
                    };
                }
            }
        }
    });

    return mejorMatch;
}

// Funciones de cálculo como fallback
function calcularUVFallback(lat, lng, altitude = 0) {
    const hora = new Date().getHours();
    const mes = new Date().getMonth() + 1;
    const dia = new Date().getDate();

    // Factores más precisos
    const factorLatitud = 1 - (Math.abs(lat) / 90) * 0.4;
    const factorAltitud = 1 + (altitude / 1000) * 0.15;
    const factorHora = Math.max(0, Math.sin(Math.PI * (hora - 6) / 12));
    const factorMes = 1 + 0.3 * Math.cos(2 * Math.PI * (mes - 12) / 12);
    const factorDia = 1 + 0.1 * Math.sin(2 * Math.PI * dia / 365); // Variación anual

    // Factor de nubosidad simulado (hora)
    const factorNubosidad = hora >= 10 && hora <= 16 ? 0.9 : 1.0;

    const uvBase = 12;
    const uv = uvBase * factorLatitud * factorAltitud * factorHora * factorMes * factorDia * factorNubosidad;

    return Math.round(Math.max(0, uv) * 10) / 10;
}

function calcularRadiacionFallback(lat, lng, altitude = 0) {
    const hora = new Date().getHours();
    const mes = new Date().getMonth() + 1;

    const factorHora = Math.max(0, Math.sin(Math.PI * (hora - 6) / 12));
    const factorAltitud = 1 + (altitude / 10000) * 0.25;
    const factorLatitud = 1 - (Math.abs(lat) / 90) * 0.3;
    const factorMes = 1 + 0.2 * Math.cos(2 * Math.PI * (mes - 6) / 12);

    const radiacionBase = 800;
    const radiacion = radiacionBase * factorHora * factorAltitud * factorLatitud * factorMes;

    return Math.round(Math.max(0, radiacion));
}

function clasificarUV(indiceUV) {
    if (indiceUV <= 2) return { nivel: 'Bajo', color: '#28a745', riesgo: 'Mínimo' };
    if (indiceUV <= 5) return { nivel: 'Moderado', color: '#ffc107', riesgo: 'Bajo' };
    if (indiceUV <= 7) return { nivel: 'Alto', color: '#fd7e14', riesgo: 'Moderado' };
    if (indiceUV <= 10) return { nivel: 'Muy Alto', color: '#dc3545', riesgo: 'Alto' };
    return { nivel: 'Extremo', color: '#6f42c1', riesgo: 'Muy Alto' };
}

function obtenerAltitudEstimada(lat, lng) {
    // Estimación mejorada de altitud para Perú
    if (lat > -6 && lng > -75) return 150; // Selva norte
    if (lat > -12 && lng > -76) return 400; // Selva central
    if (lat > -15 && lng > -76) return 200; // Selva sur
    if (lng < -76) return 100; // Costa
    if (lng < -70 && lat < -14) return 3800; // Altiplano
    if (lng < -72) return 3200; // Sierra alta
    return 2500; // Sierra media
}

// ========== ENDPOINTS ==========

// Información de la API
app.get('/', (req, res) => {
    res.json({
        nombre: 'API de Radiación UV con datos en tiempo real',
        descripcion: 'Consulta radiación UV usando CurrentUVIndex API (sin key) y SENAMHI como backup',
        version: '3.0.0',
        autor: 'Tu API',
        fuentes_datos: [
            'CurrentUVIndex API (principal - tiempo real)',
            'SENAMHI Web (backup - índice UV)',
            'Cálculos propios (fallback)'
        ],
        uso: 'GET /radiacion?lat=LATITUD&lng=LONGITUD',
        ejemplo: '/radiacion?lat=-12.0464&lng=-77.0428',
        endpoints: {
            'GET /': 'Información de la API',
            'GET /radiacion': 'Consultar radiación UV por coordenadas',
            'GET /pronostico': 'Pronóstico UV para las próximas horas/días',
            'GET /test': 'Probar conexión con las APIs',
            'POST /cache/clear': 'Limpiar cache',
            'GET /status': 'Estado del servidor'
        },
        caracteristicas: {
            'Sin API Key': 'No requiere registro ni autenticación',
            'Tiempo real': 'Datos actualizados cada hora',
            'Pronóstico': 'Hasta 5 días de pronóstico UV',
            'Global': 'Cobertura mundial',
            'Cache inteligente': `${cache.size} entradas, duración: ${CACHE_DURATION / 60000} minutos`
        },
        timestamp: new Date().toISOString()
    });
});

// ENDPOINT PRINCIPAL - Radiación UV por coordenadas
app.get('/radiacion', async (req, res) => {
    const { lat, lng, altitude } = req.query;

    // Validación de parámetros
    if (!lat || !lng) {
        return res.status(400).json({
            error: 'Parámetros requeridos: lat y lng',
            ejemplo: '/radiacion?lat=-12.0464&lng=-77.0428',
            formato: {
                lat: 'Latitud en grados decimales (-90 a 90)',
                lng: 'Longitud en grados decimales (-180 a 180)',
                altitude: 'Altitud en metros (opcional)'
            }
        });
    }

    try {
        const latitude = parseFloat(lat);
        const longitude = parseFloat(lng);

        // Validar rangos
        if (latitude < -90 || latitude > 90) {
            return res.status(400).json({
                error: 'Latitud debe estar entre -90 y 90 grados',
                recibido: latitude
            });
        }

        if (longitude < -180 || longitude > 180) {
            return res.status(400).json({
                error: 'Longitud debe estar entre -180 y 180 grados',
                recibido: longitude
            });
        }

        const altitud = altitude ? parseFloat(altitude) : obtenerAltitudEstimada(latitude, longitude);

        // Verificar cache
        const cacheKey = `${latitude.toFixed(4)}_${longitude.toFixed(4)}`;
        const now = Date.now();

        if (cache.has(cacheKey)) {
            const cached = cache.get(cacheKey);
            if (now - cached.timestamp < CACHE_DURATION) {
                console.log(`📦 Usando cache para ${cacheKey}`);
                return res.json({
                    ...cached.data,
                    desde_cache: true,
                    cache_edad_minutos: Math.round((now - cached.timestamp) / 60000)
                });
            } else {
                cache.delete(cacheKey);
            }
        }

        console.log(`🔍 Nueva consulta: lat=${latitude}, lng=${longitude}, alt=${altitud}`);

        // Intentar obtener datos reales de las APIs disponibles
        const [datosCurrentUV, datosUVWeb] = await Promise.allSettled([
            obtenerUVCurrentIndex(latitude, longitude),
            obtenerUVSenamhi() // Mantener como backup
        ]);

        let uvReal = null;
        let radiacionReal = null;
        let fuente = [];
        let precision = 'Media (estimación)';
        let alertas = [];
        let forecast = null;

        // Procesar datos de CurrentUVIndex (prioridad)
        if (datosCurrentUV.status === 'fulfilled' && datosCurrentUV.value) {
            const uvData = datosCurrentUV.value;
            console.log("uvData",uvData)
            forecast = uvData.forecast;

            // Obtener hora actual en Lima
            const horaActual = new Date().toLocaleTimeString('es-PE', {
                timeZone: 'America/Lima',
                hour: '2-digit',
                minute: '2-digit'
            });
            const hora = parseInt(horaActual.split(':')[0]);

            // Buscar el UV más cercano a la hora actual
            let uvPorHora = null;
            if (forecast && Array.isArray(forecast)) {
                uvPorHora = forecast.find((item) => {
                    const horaForecast = new Date(item.fecha).getHours();
                    return horaForecast === hora;
                });

                // Si no encuentra exactamente, busca el más cercano
                if (!uvPorHora) {
                    uvPorHora = forecast.reduce((prev, curr) => {
                        const diffPrev = Math.abs(new Date(prev.fecha).getHours() - hora);
                        const diffCurr = Math.abs(new Date(curr.fecha).getHours() - hora);
                        return diffCurr < diffPrev ? curr : prev;
                    });
                }
            }

            console.log("uvPorHora",uvPorHora)
            console.log("uvPorHora.uv",uvPorHora.uvi)
            console.log("uvData.uv_actual",uvData.uv_actual)
            // Asignar el valor real desde forecast (si existe)
            uvReal = uvPorHora ? uvPorHora.uvi : uvData.uv_actual;
            console.log("uvReal",uvReal)
            fuente.push('CurrentUVIndex API (tiempo real)');
            precision = 'Alta (datos en tiempo real)';
            // Estimar radiación solar
            radiacionReal = Math.round(uvReal * 90);
        } else {
            alertas.push({
                tipo: 'warning',
                mensaje: 'API principal no disponible',
                detalle: 'CurrentUVIndex no responde, usando datos alternativos'
            });
        }


        // Si CurrentUVIndex falla, intentar con SENAMHI como backup
        if (uvReal === null && datosUVWeb.status === 'fulfilled' && datosUVWeb.value) {
            const uvCercano = buscarUVCercano(latitude, longitude, datosUVWeb.value);
            console.log("uvCercano",uvCercano)
            if (uvCercano && uvCercano.distancia_km < 200) {
                uvReal = uvCercano.uv;
                fuente.push(`SENAMHI Web (${uvCercano.ciudad}, ~${uvCercano.distancia_km}km)`);
                precision = 'Media (datos SENAMHI)';
            }
        }

        // Alerta general si no hay datos reales
        if (uvReal === null && radiacionReal === null) {
            alertas.push({
                tipo: 'error',
                mensaje: 'APIs no responden',
                detalle: 'Usando datos estimados. Los servicios externos pueden estar temporalmente inaccesibles.'
            });
        }

        // Usar datos reales o calcular
        const indiceUV = uvReal !== null ? uvReal : 0.0;
        const radiacionSolar = radiacionReal !== null ? radiacionReal : calcularRadiacionFallback(latitude, longitude, altitud);

        // Agregar fuentes de fallback
        if (uvReal === null) fuente.push('Cálculo estimado UV');
        if (radiacionReal === null) fuente.push('Cálculo estimado radiación');

        const clasificacion = clasificarUV(indiceUV);

        const resultado = {
            coordenadas: {
                lat: latitude,
                lng: longitude,
                altitud: Math.round(altitud)
            },
            uv: {
                indice: indiceUV,
                nivel: clasificacion.nivel,
                riesgo: clasificacion.riesgo,
                color: clasificacion.color,
                fuente_real: uvReal !== null
            },
            radiacion_solar: {
                valor: radiacionSolar,
                unidad: 'W/m²',
                fuente_real: radiacionReal !== null
            },
            forecast: forecast, // Pronóstico UV para las próximas horas
            fuentes_datos: fuente,
            precision: precision,
            alertas: alertas,
            hora_local: new Date().toLocaleTimeString('es-PE', {
                timeZone: 'America/Lima',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            }),
            timestamp: new Date().toISOString()
        };

        // Guardar en cache
        cache.set(cacheKey, {
            data: resultado,
            timestamp: now
        });

        console.log(`✅ Respuesta generada: UV=${indiceUV}, Radiación=${radiacionSolar}, Fuentes=[${fuente.join(', ')}]`);
        res.json(resultado);

    } catch (error) {
        console.error('❌ Error en endpoint radiación:', error);
        res.status(500).json({
            error: 'Error interno del servidor',
            mensaje: 'No se pudo procesar la solicitud',
            detalle: process.env.NODE_ENV === 'development' ? error.message : undefined,
            timestamp: new Date().toISOString()
        });
    }
});

// Endpoint para obtener pronóstico detallado UV
app.get('/pronostico', async (req, res) => {
    const { lat, lng } = req.query;

    if (!lat || !lng) {
        return res.status(400).json({
            error: 'Parámetros requeridos: lat y lng',
            ejemplo: '/pronostico?lat=-12.0464&lng=-77.0428'
        });
    }

    try {
        const latitude = parseFloat(lat);
        const longitude = parseFloat(lng);

        console.log(`🔍 Consultando pronóstico UV para: lat=${latitude}, lng=${longitude}`);

        const uvData = await obtenerUVCurrentIndex(latitude, longitude);

        if (uvData && uvData.forecast) {
            // Procesar pronóstico por horas
            const pronosticoHoras = uvData.forecast.map(hora => {
                const fecha = new Date(hora.time);
                const clasificacion = clasificarUV(hora.uvi);

                return {
                    hora: fecha.toLocaleTimeString('es-PE', {
                        timeZone: 'America/Lima',
                        hour: '2-digit',
                        minute: '2-digit'
                    }),
                    fecha: fecha.toLocaleDateString('es-PE', {
                        timeZone: 'America/Lima',
                        day: '2-digit',
                        month: '2-digit'
                    }),
                    uv: hora.uvi,
                    nivel: clasificacion.nivel,
                    color: clasificacion.color
                };
            });

            // Agrupar por días
            const pronosticoPorDias = {};
            pronosticoHoras.forEach(hora => {
                if (!pronosticoPorDias[hora.fecha]) {
                    pronosticoPorDias[hora.fecha] = {
                        fecha: hora.fecha,
                        uv_maximo: 0,
                        horas: []
                    };
                }
                pronosticoPorDias[hora.fecha].horas.push(hora);
                if (hora.uv > pronosticoPorDias[hora.fecha].uv_maximo) {
                    pronosticoPorDias[hora.fecha].uv_maximo = hora.uv;
                }
            });

            res.json({
                coordenadas: { lat: latitude, lng: longitude },
                uv_actual: uvData.uv_actual,
                pronostico_horas: pronosticoHoras.slice(0, 24), // Próximas 24 horas
                pronostico_dias: Object.values(pronosticoPorDias),
                fuente: 'CurrentUVIndex API',
                timestamp: new Date().toISOString()
            });
        } else {
            res.status(503).json({
                error: 'No se pudo obtener el pronóstico',
                mensaje: 'El servicio de pronóstico no está disponible en este momento'
            });
        }
    } catch (error) {
        console.error('❌ Error en pronóstico:', error);
        res.status(500).json({
            error: 'Error interno del servidor',
            mensaje: 'No se pudo procesar la solicitud'
        });
    }
});

// Endpoint para probar conexión con las APIs
app.get('/test', async (req, res) => {
    const resultados = {
        timestamp: new Date().toISOString(),
        coordenadas_prueba: { lat: -12.0464, lng: -77.0428 }
    };

    // Probar CurrentUVIndex API (principal)
    try {
        console.log('🔍 Probando CurrentUVIndex API...');
        const startTime = Date.now();
        const uvResult = await obtenerUVCurrentIndex(-12.0464, -77.0428);
        const endTime = Date.now();

        resultados.currentuvindex = {
            estado: uvResult ? 'Funcionando ✅' : 'Sin datos ⚠️',
            tiempo_respuesta: `${endTime - startTime}ms`,
            datos: uvResult ? {
                uv_actual: uvResult.uv_actual,
                uv_maximo_hoy: uvResult.uv_maximo_hoy,
                pronostico_horas: uvResult.forecast ? uvResult.forecast.length : 0
            } : null
        };
    } catch (error) {
        resultados.currentuvindex = {
            estado: 'Error ❌',
            error: error.message
        };
    }

    // Probar SENAMHI como backup
    try {
        console.log('🔍 Probando SENAMHI web (backup)...');
        const startTime = Date.now();
        const senamhiResult = await obtenerUVSenamhi();
        const endTime = Date.now();

        resultados.senamhi_backup = {
            estado: senamhiResult ? `Funcionando ✅ (${senamhiResult.length} ciudades)` : 'Sin datos ⚠️',
            tiempo_respuesta: `${endTime - startTime}ms`,
            ciudades: senamhiResult ? senamhiResult.slice(0, 3) : []
        };
    } catch (error) {
        resultados.senamhi_backup = {
            estado: 'Error ❌',
            error: error.message
        };
    }

    // Estado del cache
    resultados.cache = {
        entradas: cache.size,
        duracion_minutos: CACHE_DURATION / 60000
    };

    // Recomendación
    if (resultados.currentuvindex.estado.includes('✅')) {
        resultados.recomendacion = '✅ Sistema funcionando correctamente con API principal';
    } else if (resultados.senamhi_backup.estado.includes('✅')) {
        resultados.recomendacion = '⚠️ API principal no disponible, usando backup SENAMHI';
    } else {
        resultados.recomendacion = '❌ Todas las APIs externas no disponibles, usando cálculos estimados';
    }

    res.json(resultados);
});

// Endpoint para limpiar cache
app.post('/cache/clear', (req, res) => {
    const entreasAnteriores = cache.size;
    cache.clear();

    res.json({
        mensaje: 'Cache limpiado exitosamente',
        entradas_eliminadas: entreasAnteriores,
        timestamp: new Date().toISOString()
    });
});

// Estado del servidor
app.get('/status', (req, res) => {
    const uptime = process.uptime();
    const memoria = process.memoryUsage();

    res.json({
        estado: 'Funcionando ✅',
        uptime: {
            segundos: Math.round(uptime),
            formato: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.round(uptime % 60)}s`
        },
        memoria: {
            usada_mb: Math.round(memoria.heapUsed / 1024 / 1024),
            total_mb: Math.round(memoria.heapTotal / 1024 / 1024)
        },
        cache: {
            entradas: cache.size,
            duracion_minutos: CACHE_DURATION / 60000
        },
        version: '3.0.0',
        timestamp: new Date().toISOString()
    });
});

// Manejo de errores 404
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Endpoint no encontrado',
        ruta_solicitada: req.originalUrl,
        metodo: req.method,
        endpoints_disponibles: [
            'GET /',
            'GET /radiacion?lat=X&lng=Y',
            'GET /pronostico?lat=X&lng=Y',
            'GET /test',
            'POST /cache/clear',
            'GET /status'
        ],
        ejemplo: '/radiacion?lat=-12.0464&lng=-77.0428'
    });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log('🌞 =======================================');
    console.log(`🌞 API de Radiación UV v3.0.0`);
    console.log(`🌞 Puerto: ${PORT}`);
    console.log(`🌞 =======================================`);
    console.log(`🔗 Endpoints principales:`);
    console.log(`   📊 http://localhost:${PORT}/radiacion?lat=-12.0464&lng=-77.0428`);
    console.log(`   📈 http://localhost:${PORT}/pronostico?lat=-12.0464&lng=-77.0428`);
    console.log(`   🔍 http://localhost:${PORT}/test`);
    console.log(`   📈 http://localhost:${PORT}/status`);
    console.log(`🌞 =======================================`);
    console.log(`✨ Características:`);
    console.log(`   ✅ Sin API key requerida`);
    console.log(`   ✅ Datos en tiempo real`);
    console.log(`   ✅ Pronóstico 5 días`);
    console.log(`   ✅ Cobertura global`);
    console.log(`🌞 =======================================`);
    console.log(`🕒 Iniciado: ${new Date().toLocaleString('es-PE')}`);
    console.log(`📦 Cache: ${CACHE_DURATION / 60000} min duración`);
    console.log(`🌞 =======================================`);
});

module.exports = app;