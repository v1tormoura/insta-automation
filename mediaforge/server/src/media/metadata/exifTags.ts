import type { IfdName } from './tiff';
import { classifyKey, type ItemCategory } from './categories';

type TagDef = [name: string, category: ItemCategory, sensitive?: boolean];

const IFD0_TAGS: Record<number, TagDef> = {
  0x010e: ['ImageDescription', 'descriptive'],
  0x010f: ['Make', 'device'],
  0x0110: ['Model', 'device'],
  0x0112: ['Orientation', 'technical', false],
  0x011a: ['XResolution', 'technical', false],
  0x011b: ['YResolution', 'technical', false],
  0x0128: ['ResolutionUnit', 'technical', false],
  0x0131: ['Software', 'software'],
  0x0132: ['DateTime', 'dates'],
  0x013b: ['Artist', 'descriptive'],
  0x013c: ['HostComputer', 'device'],
  0x0213: ['YCbCrPositioning', 'technical', false],
  0x02bc: ['XMP (TIFF)', 'custom'],
  0x83bb: ['IPTC (TIFF)', 'custom'],
  0x8298: ['Copyright', 'descriptive'],
  0x8773: ['ICC (TIFF)', 'technical', false],
  0x4746: ['Rating', 'descriptive'],
  0x4749: ['RatingPercent', 'descriptive'],
  0x9c9b: ['XPTitle', 'descriptive'],
  0x9c9c: ['XPComment', 'descriptive'],
  0x9c9d: ['XPAuthor', 'descriptive'],
  0x9c9e: ['XPKeywords', 'descriptive'],
  0x9c9f: ['XPSubject', 'descriptive'],
  0xc614: ['UniqueCameraModel', 'device'],
  0xc4a5: ['PrintIM', 'custom', false],
};

const EXIF_TAGS: Record<number, TagDef> = {
  0x829a: ['ExposureTime', 'device', false],
  0x829d: ['FNumber', 'device', false],
  0x8822: ['ExposureProgram', 'device', false],
  0x8827: ['ISO', 'device', false],
  0x8830: ['SensitivityType', 'device', false],
  0x9000: ['ExifVersion', 'technical', false],
  0x9003: ['DateTimeOriginal', 'dates'],
  0x9004: ['DateTimeDigitized', 'dates'],
  0x9010: ['OffsetTime', 'dates'],
  0x9011: ['OffsetTimeOriginal', 'dates'],
  0x9012: ['OffsetTimeDigitized', 'dates'],
  0x9101: ['ComponentsConfiguration', 'technical', false],
  0x9201: ['ShutterSpeedValue', 'device', false],
  0x9202: ['ApertureValue', 'device', false],
  0x9203: ['BrightnessValue', 'device', false],
  0x9204: ['ExposureBiasValue', 'device', false],
  0x9205: ['MaxApertureValue', 'device', false],
  0x9207: ['MeteringMode', 'device', false],
  0x9209: ['Flash', 'device', false],
  0x920a: ['FocalLength', 'device', false],
  0x9214: ['SubjectArea', 'device', false],
  0x927c: ['MakerNote', 'device', true],
  0x9286: ['UserComment', 'descriptive'],
  0x9290: ['SubSecTime', 'dates'],
  0x9291: ['SubSecTimeOriginal', 'dates'],
  0x9292: ['SubSecTimeDigitized', 'dates'],
  0xa000: ['FlashpixVersion', 'technical', false],
  0xa001: ['ColorSpace', 'technical', false],
  0xa002: ['PixelXDimension', 'technical', false],
  0xa003: ['PixelYDimension', 'technical', false],
  0xa217: ['SensingMethod', 'device', false],
  0xa300: ['FileSource', 'device', false],
  0xa301: ['SceneType', 'device', false],
  0xa401: ['CustomRendered', 'device', false],
  0xa402: ['ExposureMode', 'device', false],
  0xa403: ['WhiteBalance', 'device', false],
  0xa404: ['DigitalZoomRatio', 'device', false],
  0xa405: ['FocalLengthIn35mmFormat', 'device', false],
  0xa406: ['SceneCaptureType', 'device', false],
  0xa420: ['ImageUniqueID', 'custom', true],
  0xa430: ['CameraOwnerName', 'device'],
  0xa431: ['BodySerialNumber', 'device'],
  0xa432: ['LensSpecification', 'device', false],
  0xa433: ['LensMake', 'device'],
  0xa434: ['LensModel', 'device'],
  0xa435: ['LensSerialNumber', 'device'],
};

const GPS_TAGS: Record<number, string> = {
  0x0000: 'GPSVersionID',
  0x0001: 'GPSLatitudeRef',
  0x0002: 'GPSLatitude',
  0x0003: 'GPSLongitudeRef',
  0x0004: 'GPSLongitude',
  0x0005: 'GPSAltitudeRef',
  0x0006: 'GPSAltitude',
  0x0007: 'GPSTimeStamp',
  0x0008: 'GPSSatellites',
  0x000c: 'GPSSpeedRef',
  0x000d: 'GPSSpeed',
  0x0010: 'GPSImgDirectionRef',
  0x0011: 'GPSImgDirection',
  0x0012: 'GPSMapDatum',
  0x0017: 'GPSDestBearingRef',
  0x0018: 'GPSDestBearing',
  0x001b: 'GPSProcessingMethod',
  0x001d: 'GPSDateStamp',
  0x001f: 'GPSHPositioningError',
};

export interface ExifTagInfo {
  name: string;
  category: ItemCategory;
  sensitive: boolean;
}

export function exifTagInfo(ifd: IfdName, tag: number): ExifTagInfo {
  const hex = `0x${tag.toString(16).padStart(4, '0')}`;
  if (ifd === 'gps') return { name: GPS_TAGS[tag] ?? `GPS ${hex}`, category: 'gps', sensitive: true };
  if (ifd === 'interop') return { name: `Interop ${hex}`, category: 'technical', sensitive: false };
  if (ifd === 'ifd1') return { name: `Miniatura ${hex}`, category: 'custom', sensitive: true };
  const def = (ifd === 'ifd0' ? IFD0_TAGS[tag] : EXIF_TAGS[tag]) ?? (ifd === 'ifd0' ? EXIF_TAGS[tag] : IFD0_TAGS[tag]);
  if (def) return { name: def[0], category: def[1], sensitive: def[2] ?? def[1] !== 'technical' };
  const c = classifyKey(`tag ${hex}`, 'exif');
  return { name: `Tag ${hex}`, category: c.category, sensitive: c.sensitive };
}
